// Document side of the continuity bridge (docs/message-port.md): hand an
// authenticated port to the same-origin Service Worker before replacing this
// document, and claim it back from the next one. The worker handler lives in
// ./worker.ts; this file owns the wire records both sides share.

import { PopupError } from './diagnostics.js'
import {
  CONNECTION_VERSION,
  hasExactKeys,
  isAllowedOrigin,
  isConnectionId,
  isRecord,
} from './message.js'

export const CARRIER_CLAIM_TIMEOUT_MS = 5_000
export const KEEPER_REPLY_TIMEOUT_MS = 2_000

export const KEEP = 'libid-popup-keep'
export const CLAIM = 'libid-popup-claim'

export type KeeperRequest = {
  connectionVersion: typeof CONNECTION_VERSION
  connectionId: string
} & ({ type: typeof KEEP; peerOrigin: string } | { type: typeof CLAIM })

export function decodeKeeperRequest(value: unknown): KeeperRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      value.type === KEEP
        ? ['type', 'connectionVersion', 'connectionId', 'peerOrigin']
        : ['type', 'connectionVersion', 'connectionId'],
    ) ||
    (value.type !== KEEP && value.type !== CLAIM) ||
    value.connectionVersion !== CONNECTION_VERSION ||
    !isConnectionId(value.connectionId) ||
    (value.type === KEEP &&
      (typeof value.peerOrigin !== 'string' || !isAllowedOrigin(value.peerOrigin, '*')))
  ) {
    return null
  }
  return value as KeeperRequest
}

/** The subset of ServiceWorker the keeper needs; injectable for tests. */
export interface KeeperWorker {
  postMessage(message: unknown, transfer: Transferable[]): void
}

/** Resolves to undefined once the deadline passes. */
export function bounded<T>(
  promise: Promise<T>,
  timeoutMs = KEEPER_REPLY_TIMEOUT_MS,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

/**
 * The registration's active worker, waiting briefly for one still
 * installing (the host registers in the first participating document).
 */
export function activeWorker(
  registration: ServiceWorkerRegistration,
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
    const timer = setTimeout(() => finish(null), KEEPER_REPLY_TIMEOUT_MS)
    worker.addEventListener('statechange', onChange)
  })
}

/**
 * The registration `lookup` names once it exists and is active, or undefined
 * past the keeper reply deadline. The host may register in this very
 * document, so an absent registration, or one the engine already exposes
 * before attaching its installing worker, is polled for rather than refused.
 */
export async function activeRegistration(
  lookup: () => Promise<ServiceWorkerRegistration | undefined>,
): Promise<ServiceWorkerRegistration | undefined> {
  const deadline = Date.now() + KEEPER_REPLY_TIMEOUT_MS
  const attached = (r?: ServiceWorkerRegistration): boolean =>
    !!r && (r.active ?? r.installing ?? r.waiting) !== null
  let registration = await lookup()
  while (!attached(registration) && Date.now() < deadline) {
    // ponytail: nothing announces a new registration; poll until the deadline.
    await new Promise((resolve) => setTimeout(resolve, 50))
    registration = await lookup()
  }
  if (!registration) return undefined
  return (await activeWorker(registration)) ? registration : undefined
}

export class PortKeeper {
  constructor(private readonly worker: KeeperWorker) {}

  /** Resolves only after the worker owns the port. */
  async keep(connectionId: string, port: MessagePort, peerOrigin: string): Promise<void> {
    const reply = await this.exchange(
      { type: KEEP, connectionVersion: CONNECTION_VERSION, connectionId, peerOrigin },
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
  async claim(connectionId: string): Promise<{ port: MessagePort; peerOrigin: string } | null> {
    const reply = await this.exchange(
      { type: CLAIM, connectionVersion: CONNECTION_VERSION, connectionId },
      [],
      'claim-failed',
    )
    if (!reply) return null
    const { data, ports } = reply
    if (isRecord(data)) {
      if (hasExactKeys(data, ['port']) && data.port === false && ports.length === 0) return null
      if (
        hasExactKeys(data, ['port', 'peerOrigin']) &&
        data.port === true &&
        ports.length === 1 &&
        typeof data.peerOrigin === 'string' &&
        isAllowedOrigin(data.peerOrigin, '*')
      )
        return { port: ports[0], peerOrigin: data.peerOrigin }
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
