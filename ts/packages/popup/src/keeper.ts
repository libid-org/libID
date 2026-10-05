// Document side of the continuity bridge (docs/message-port.md): hand an
// authenticated port to the same-origin Service Worker before replacing this
// document, and claim it back from the next one. The worker handler lives in
// ./worker.ts; this file owns the wire records both sides share.

import { PopupError } from './diagnostics.js'
import {
  CONNECTION_VERSION,
  DEPARTED,
  hasExactKeys,
  isAllowedOrigin,
  isConnectionId,
  isRecord,
} from './message.js'

export const CARRIER_CLAIM_TIMEOUT_MS = 5_000
export const KEEPER_REPLY_TIMEOUT_MS = 2_000

export const KEEP = 'libid-popup-keep'
export const CLAIM = 'libid-popup-claim'

/**
 * A backlog holds the values a started port dispatched to the source after
 * it chose to leave. The worker holds it with the port, unread; it is
 * spelled only when nonempty.
 */
export type KeeperRequest = {
  connectionVersion: typeof CONNECTION_VERSION
  connectionId: string
} & ({ type: typeof KEEP; peerOrigin: string; backlog?: unknown[] } | { type: typeof CLAIM })

const isBacklog = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0

export function decodeKeeperRequest(value: unknown): KeeperRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      value.type !== KEEP
        ? ['type', 'connectionVersion', 'connectionId']
        : 'backlog' in value
          ? ['type', 'connectionVersion', 'connectionId', 'peerOrigin', 'backlog']
          : ['type', 'connectionVersion', 'connectionId', 'peerOrigin'],
    ) ||
    (value.type !== KEEP && value.type !== CLAIM) ||
    value.connectionVersion !== CONNECTION_VERSION ||
    !isConnectionId(value.connectionId) ||
    (value.type === KEEP &&
      (typeof value.peerOrigin !== 'string' ||
        !isAllowedOrigin(value.peerOrigin, '*') ||
        ('backlog' in value && !isBacklog(value.backlog))))
  ) {
    return null
  }
  return value as KeeperRequest
}

/** Closes a port, telling the application first: a closed port alone tells it nothing. */
export function depart(port: MessagePort): void {
  try {
    port.postMessage(DEPARTED)
  } catch {
    // Nothing more can reach the application.
  }
  port.close()
}

/** The subset of ServiceWorker the keeper needs; injectable for tests. */
export interface KeeperWorker {
  postMessage(message: unknown, transfer: Transferable[]): void
}

/**
 * The registration's active worker, waiting up to `timeoutMs` for one still
 * installing (the host registers in the first participating document).
 */
function activeWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
): Promise<ServiceWorker | null> {
  if (registration.active) return Promise.resolve(registration.active)
  const worker = registration.installing ?? registration.waiting
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    const finish = (value: ServiceWorker | null): void => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onChange)
      resolve(value)
    }
    const onChange = (): void => {
      if (worker.state === 'activated') finish(worker)
      else if (worker.state === 'redundant') finish(null)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    worker.addEventListener('statechange', onChange)
  })
}

/**
 * The registration `lookup` names once it exists and is active, or undefined
 * past the one keeper reply deadline covering both waits. The host may register in this very
 * document, so an absent registration, or one the engine already exposes
 * before attaching its installing worker, is polled for rather than refused.
 */
export async function activeRegistration(
  lookup: () => Promise<ServiceWorkerRegistration | undefined>,
): Promise<ServiceWorkerRegistration | undefined> {
  const deadline = Date.now() + KEEPER_REPLY_TIMEOUT_MS
  const remaining = (): number => Math.max(0, deadline - Date.now())
  const attached = (r?: ServiceWorkerRegistration): boolean =>
    !!r && (r.active ?? r.installing ?? r.waiting) !== null
  let registration = await lookup()
  while (!attached(registration) && remaining() > 0) {
    // ponytail: nothing announces a new registration; poll until the deadline.
    await new Promise((resolve) => setTimeout(resolve, 50))
    registration = await lookup()
  }
  if (!registration) return undefined
  return (await activeWorker(registration, remaining())) ? registration : undefined
}

export class PortKeeper {
  constructor(private readonly worker: KeeperWorker) {}

  /** Resolves only after the worker owns the port and its backlog. */
  async keep(
    connectionId: string,
    port: MessagePort,
    peerOrigin: string,
    backlog: unknown[] = [],
  ): Promise<void> {
    const reply = await this.exchange(
      {
        type: KEEP,
        connectionVersion: CONNECTION_VERSION,
        connectionId,
        peerOrigin,
        ...(backlog.length > 0 && { backlog }),
      },
      [port],
      'keep-failed',
    )
    if (!reply || !isRecord(reply.data) || reply.data.ok !== true || reply.ports.length !== 0) {
      throw new PopupError('keep-failed')
    }
  }

  /**
   * The preserved port, or null when the worker holds no entry. A worker
   * that does not answer is treated as holding nothing, so an unrelated
   * worker on the origin never blocks a fresh handshake; a malformed
   * answer is a failure.
   */
  async claim(
    connectionId: string,
  ): Promise<{ port: MessagePort; peerOrigin: string; backlog: unknown[] } | null> {
    const reply = await this.exchange(
      { type: CLAIM, connectionVersion: CONNECTION_VERSION, connectionId },
      [],
      'claim-failed',
    )
    if (!reply) return null
    const { data, ports } = reply
    if (isRecord(data)) {
      if (hasExactKeys(data, ['port']) && data.port === false && ports.length === 0) return null
      const backlog = 'backlog' in data
      if (
        hasExactKeys(data, backlog ? ['port', 'peerOrigin', 'backlog'] : ['port', 'peerOrigin']) &&
        data.port === true &&
        ports.length === 1 &&
        typeof data.peerOrigin === 'string' &&
        isAllowedOrigin(data.peerOrigin, '*') &&
        (!backlog || isBacklog(data.backlog))
      )
        return {
          port: ports[0],
          peerOrigin: data.peerOrigin,
          backlog: backlog ? (data.backlog as unknown[]) : [],
        }
    }
    for (const port of ports) port.close()
    throw new PopupError('claim-failed')
  }

  /** One request with its own reply port; null when the worker stays silent. */
  private exchange(
    message: KeeperRequest,
    transfer: MessagePort[],
    code: 'keep-failed' | 'claim-failed',
  ): Promise<MessageEvent | null> {
    return new Promise((resolve, reject) => {
      const reply = new MessageChannel()
      const finish = (error: Error | null, event: MessageEvent | null = null): void => {
        clearTimeout(timer)
        reply.port1.onmessage = null
        reply.port1.close()
        if (error) reject(error)
        else resolve(event)
      }
      const timer = setTimeout(() => finish(null), KEEPER_REPLY_TIMEOUT_MS)
      reply.port1.onmessage = (event: MessageEvent): void => finish(null, event)
      try {
        this.worker.postMessage(message, [...transfer, reply.port2])
      } catch {
        finish(new PopupError(code))
      }
    })
  }
}
