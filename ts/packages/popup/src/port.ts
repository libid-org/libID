// The MessagePort carrier (docs/message-port.md): one window.postMessage
// exchange authenticates browser-stamped source and origin and transfers one
// end of a MessageChannel; the popup then echoes the same record over the
// port as the final acknowledgement. The entangled ports carry caller values
// unchanged.

import { PopupError } from './diagnostics.js'
import {
  type Carrier,
  CONNECTION_VERSION,
  hasExactKeys,
  isAllowedOrigin,
  isRecord,
  type Message,
  type OriginAllowlist,
} from './message.js'
import type { View } from './window.js'

export const OPENER_HANDSHAKE_TIMEOUT_MS = 30_000

const HANDSHAKE = 'message-port'

interface Handshake {
  type: typeof HANDSHAKE
  connectionVersion: typeof CONNECTION_VERSION
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

function isWindow(source: MessageEventSource | null): source is WindowProxy {
  return source !== null && 'postMessage' in source && 'closed' in source
}

export interface ListenOptions {
  view: View
  /** The retained handle, or null until native-anchor binding. */
  source: WindowProxy | null
  onBind: (source: WindowProxy) => void
  allowedPopupOrigins: readonly string[]
  connectionId: string
}

export interface ListenHandlers {
  /** The application's authenticated endpoint for one popup document. */
  onPort: (port: MessagePort) => void
  /** The expected peer sent a malformed handshake or acknowledgement. */
  onFail: () => void
}

/**
 * Application side. One window listener for the connection lifetime: each
 * accepted handshake yields one port; per-attempt state is discarded on
 * acceptance, supersession, or stop. An attempt from any window or origin
 * other than the expected peer is not an attempt on this connection and is
 * ignored, so nothing that merely knows the connection ID can end it.
 */
export function listenForPopupPorts(options: ListenOptions, handlers: ListenHandlers): () => void {
  const { view, allowedPopupOrigins, connectionId } = options
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
    if (!allowedPopupOrigins.includes(event.origin)) return
    if (source !== null ? event.source !== source : !isWindow(event.source)) return
    if (!isExactHandshake(event.data, connectionId) || event.ports.length !== 0) {
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
 * transferred, acknowledged port, or null when the opener stays silent past
 * the deadline (the caller then commits its fallback). Rejects with
 * `handshake-rejected` when the opener answers wrongly and `connection-closed`
 * on abort; every rejection closes reachable ports.
 */
export function requestApplicationPort(options: RequestOptions): Promise<MessagePort | null> {
  const { view, opener, allowedOrigins, connectionId, signal } = options
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, port: MessagePort | null = null): void => {
      view.removeEventListener('message', listener)
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(port)
    }
    const listener = (event: MessageEvent): void => {
      if (!isAttempt(event.data, connectionId) || event.source !== opener) return
      if (
        !isAllowedOrigin(event.origin, allowedOrigins) ||
        !isExactHandshake(event.data, connectionId) ||
        event.ports.length !== 1
      ) {
        for (const port of event.ports) port.close()
        finish(new PopupError('handshake-rejected'))
        return
      }
      const port = event.ports[0]
      try {
        port.postMessage(handshake(connectionId))
      } catch {
        port.close()
        finish(new PopupError('handshake-rejected'))
        return
      }
      finish(null, port)
    }
    const onAbort = (): void => finish(new PopupError('connection-closed'))
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? OPENER_HANDSHAKE_TIMEOUT_MS)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    view.addEventListener('message', listener)
    try {
      opener.postMessage(handshake(connectionId), '*')
    } catch {
      finish(new PopupError('handshake-rejected'))
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
    if (!this.port) throw new PopupError('send-unavailable')
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
    this.take()?.close()
  }

  /** Surrenders the port for preservation; this carrier is closed afterwards. */
  detach(): MessagePort {
    const port = this.take()
    if (!port) throw new PopupError('send-unavailable')
    return port
  }

  private take(): MessagePort | null {
    const port = this.port
    if (!port) return null
    this.port = null
    port.onmessage = null
    port.onmessageerror = null
    return port
  }
}
