// The MessagePort carrier (docs/message-port.md): one window.postMessage
// exchange authenticates browser-stamped source and origin and transfers one
// end of a MessageChannel; the popup then echoes the same record over the
// port as the final acknowledgement. The entangled ports carry caller values
// unchanged.

import type { Reporter } from './diagnostics.js'
import { failure } from './diagnostics.js'
import {
  type Carrier,
  hasExactKeys,
  isAllowedOrigin,
  isRecord,
  type Message,
  type OriginAllowlist,
} from './message.js'
import type { View } from './window.js'

export const CONNECTION_VERSION = 1 as const
export type ConnectionVersion = typeof CONNECTION_VERSION

export const OPENER_HANDSHAKE_TIMEOUT_MS = 30_000

const HANDSHAKE = 'message-port'

interface Handshake {
  type: typeof HANDSHAKE
  connectionVersion: ConnectionVersion
  connectionId: string
}

const handshake = (connectionId: string): Handshake => ({
  type: HANDSHAKE,
  connectionVersion: CONNECTION_VERSION,
  connectionId,
})

/** Whether an event is addressed to this connection at all. */
function isAttempt(data: unknown, connectionId: string): data is Record<string, unknown> {
  return isRecord(data) && data.type === HANDSHAKE && data.connectionId === connectionId
}

function isExactHandshake(data: unknown, connectionId: string): boolean {
  return (
    isAttempt(data, connectionId) &&
    hasExactKeys(data, ['type', 'connectionVersion', 'connectionId']) &&
    data.connectionVersion === CONNECTION_VERSION
  )
}

export interface ListenOptions {
  view: View
  /** The retained handle, or null until native-anchor binding. */
  source: WindowProxy | null
  onBind: (source: WindowProxy) => void
  allowedPopupOrigins: readonly string[]
  connectionId: string
  report: Reporter
}

export interface ListenHandlers {
  /** The application's authenticated endpoint for one popup document. */
  onPort: (port: MessagePort) => void
  /** An attempt from the expected source failed authentication. */
  onFail: () => void
}

/**
 * Application side. One window listener for the connection lifetime: each
 * accepted handshake yields one port; per-attempt state is discarded on
 * acceptance, supersession, or stop.
 */
export function listenForPopupPorts(options: ListenOptions, handlers: ListenHandlers): () => void {
  const { view, allowedPopupOrigins, connectionId, report } = options
  let source = options.source
  let pending: MessagePort | null = null

  const dropPending = (): void => {
    if (pending) {
      pending.onmessage = null
      pending.close()
      pending = null
    }
  }

  const listener = (event: MessageEvent): void => {
    if (!isAttempt(event.data, connectionId)) return
    if (
      !allowedPopupOrigins.includes(event.origin) ||
      (source !== null && event.source !== source) ||
      (source === null && (event.source === null || !('postMessage' in event.source))) ||
      !isExactHandshake(event.data, connectionId) ||
      event.ports.length !== 0
    ) {
      report('handshake-rejected')
      dropPending()
      handlers.onFail()
      return
    }
    if (source === null) {
      source = event.source as WindowProxy
      options.onBind(source)
    }
    dropPending()
    const channel = new MessageChannel()
    const port = channel.port1
    pending = port
    port.onmessage = (ack: MessageEvent): void => {
      if (pending !== port) return
      if (!isExactHandshake(ack.data, connectionId) || ack.ports.length !== 0) {
        report('handshake-rejected')
        dropPending()
        handlers.onFail()
        return
      }
      pending = null
      port.onmessage = null
      handlers.onPort(port)
    }
    try {
      // The response targets the exact origin the browser stamped on the request.
      source.postMessage(handshake(connectionId), event.origin, [channel.port2])
    } catch {
      // A discarded popup context cannot be answered; the attempt lapses.
      dropPending()
    }
  }

  view.addEventListener('message', listener)
  return () => {
    view.removeEventListener('message', listener)
    dropPending()
  }
}

export interface RequestOptions {
  view: View
  opener: WindowProxy
  allowedOrigins: OriginAllowlist
  connectionId: string
  signal: AbortSignal
  timeoutMs?: number
}

/**
 * Popup side. Sends the handshake to the exact opener and resolves the
 * transferred, acknowledged port. Rejects with `handshake-rejected` on an
 * authentication failure, `opener-timeout` on silence, and
 * `connection-closed` on abort; every rejection closes reachable ports.
 */
export function requestApplicationPort(options: RequestOptions): Promise<MessagePort> {
  const { view, opener, allowedOrigins, connectionId, signal } = options
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, port?: MessagePort): void => {
      view.removeEventListener('message', listener)
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(port as MessagePort)
    }
    const listener = (event: MessageEvent): void => {
      if (!isAttempt(event.data, connectionId)) return
      if (
        event.source !== opener ||
        !isAllowedOrigin(event.origin, allowedOrigins) ||
        !isExactHandshake(event.data, connectionId) ||
        event.ports.length !== 1
      ) {
        for (const port of event.ports) port.close()
        finish(failure('handshake-rejected'))
        return
      }
      const port = event.ports[0]
      try {
        port.postMessage(handshake(connectionId))
      } catch {
        port.close()
        finish(failure('handshake-rejected'))
        return
      }
      finish(null, port)
    }
    const onAbort = (): void => finish(failure('connection-closed'))
    const timer = setTimeout(
      () => finish(failure('opener-timeout')),
      options.timeoutMs ?? OPENER_HANDSHAKE_TIMEOUT_MS,
    )
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    view.addEventListener('message', listener)
    try {
      opener.postMessage(handshake(connectionId), '*')
    } catch {
      finish(failure('handshake-rejected'))
    }
  })
}

/** Adapts one authenticated MessagePort to the carrier operations. */
export class PortCarrier implements Carrier {
  private port: MessagePort | null

  constructor(port: MessagePort) {
    this.port = port
  }

  send(value: Message): void {
    if (!this.port) throw failure('send-unavailable')
    try {
      this.port.postMessage(value)
    } catch (error) {
      // DataCloneError: the value cannot cross; the carrier is unusable.
      this.close()
      throw error
    }
  }

  on(handler: (value: unknown) => void): () => void {
    const port = this.port
    if (!port) return () => {}
    port.onmessage = (event: MessageEvent): void => handler(event.data)
    port.onmessageerror = (): void => this.close()
    port.start()
    return () => {
      if (this.port === port) {
        port.onmessage = null
        port.onmessageerror = null
      }
    }
  }

  close(): void {
    const port = this.port
    if (!port) return
    this.port = null
    port.onmessage = null
    port.onmessageerror = null
    port.close()
  }

  /** Surrenders the port for preservation; this carrier is closed afterwards. */
  detach(): MessagePort {
    const port = this.port
    if (!port) throw failure('send-unavailable')
    this.port = null
    port.onmessage = null
    port.onmessageerror = null
    return port
  }
}
