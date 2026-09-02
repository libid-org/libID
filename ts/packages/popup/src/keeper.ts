// Document side of the continuity bridge (docs/message-port.md): hand an
// authenticated port to the same-origin Service Worker before replacing this
// document, and claim it back from the next one. The worker handler lives in
// ./worker.ts; this file owns the wire records both sides share.

import { failure } from './diagnostics.js'
import { hasExactKeys, isConnectionId, isRecord } from './message.js'
import { CONNECTION_VERSION, type ConnectionVersion } from './port.js'

export const CARRIER_CLAIM_TIMEOUT_MS = 5_000
export const KEEPER_REPLY_TIMEOUT_MS = 2_000

export const KEEP = 'libid-popup-keep'
export const CLAIM = 'libid-popup-claim'

export interface KeeperRequest {
  type: typeof KEEP | typeof CLAIM
  connectionVersion: ConnectionVersion
  connectionId: string
}

export function decodeKeeperRequest(value: unknown): KeeperRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['type', 'connectionVersion', 'connectionId']) ||
    (value.type !== KEEP && value.type !== CLAIM) ||
    value.connectionVersion !== CONNECTION_VERSION ||
    !isConnectionId(value.connectionId)
  ) {
    return null
  }
  return {
    type: value.type,
    connectionVersion: CONNECTION_VERSION,
    connectionId: value.connectionId,
  }
}

/** The subset of ServiceWorker the keeper needs; injectable for tests. */
export interface KeeperWorker {
  postMessage(message: unknown, transfer: Transferable[]): void
}

/**
 * The registration's active worker, waiting briefly for one still
 * installing (the host registers in the first participating document).
 */
export function activeWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = KEEPER_REPLY_TIMEOUT_MS,
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

export class PortKeeper {
  constructor(private readonly worker: KeeperWorker) {}

  /** Resolves only after the worker owns the port. */
  async keep(connectionId: string, port: MessagePort): Promise<void> {
    const reply = await this.exchange(KEEP, connectionId, [port], 'keep-failed')
    if (!isRecord(reply.data) || reply.data.ok !== true || reply.ports.length !== 0) {
      throw failure('keep-failed')
    }
  }

  /** The preserved port, or null when the worker holds no entry. */
  async claim(connectionId: string): Promise<MessagePort | null> {
    const reply = await this.exchange(CLAIM, connectionId, [], 'claim-failed')
    const { data, ports } = reply
    if (isRecord(data) && hasExactKeys(data, ['port'])) {
      if (data.port === false && ports.length === 0) return null
      if (data.port === true && ports.length === 1) return ports[0]
    }
    for (const port of ports) port.close()
    throw failure('claim-failed')
  }

  private exchange(
    type: KeeperRequest['type'],
    connectionId: string,
    transfer: MessagePort[],
    code: 'keep-failed' | 'claim-failed',
  ): Promise<MessageEvent> {
    return new Promise((resolve, reject) => {
      const reply = new MessageChannel()
      const finish = (error: Error | null, event?: MessageEvent): void => {
        clearTimeout(timer)
        reply.port1.onmessage = null
        reply.port1.close()
        if (error) reject(error)
        else resolve(event as MessageEvent)
      }
      const timer = setTimeout(() => finish(failure(code)), KEEPER_REPLY_TIMEOUT_MS)
      reply.port1.onmessage = (event: MessageEvent): void => finish(null, event)
      const message: KeeperRequest = { type, connectionVersion: CONNECTION_VERSION, connectionId }
      try {
        this.worker.postMessage(message, [...transfer, reply.port2])
      } catch {
        finish(failure(code))
      }
    })
  }
}
