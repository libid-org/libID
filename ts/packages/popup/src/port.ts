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

/** The popup's answer to a response it will not accept, so the application fails at once. */
const refusal = (connectionId: string) => ({ ...handshake(connectionId), refused: true })

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
  allowedPopupOrigins: OriginAllowlist
  connectionId: string
}

export interface ListenHandlers {
  /** The application's authenticated endpoint for one popup document. */
  onPort: (port: MessagePort, peerOrigin: string) => void
  /** The expected peer sent a malformed handshake or acknowledgement. */
  onFail: () => void
  /** Whether a validated handshake is awaiting its port acknowledgement. */
  onPending?: (pending: boolean) => void
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
  let lapse: ReturnType<typeof setTimeout> | undefined

  const dropPending = (): void => {
    clearTimeout(lapse)
    if (pending) {
      pending.onmessage = null
      pending.close()
      pending = null
      handlers.onPending?.(false)
    }
  }

  const listener = (event: MessageEvent): void => {
    if (!isAttempt(event.data, connectionId)) return
    if (!isAllowedOrigin(event.origin, allowedPopupOrigins)) return
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
    handlers.onPending?.(true)
    // A popup closed or navigated mid-handshake never acknowledges; the attempt then lapses
    // so the window check can see the popup gone.
    lapse = setTimeout(dropPending, OPENER_HANDSHAKE_TIMEOUT_MS)
    port.onmessage = (ack: MessageEvent): void => {
      if (pending !== port) return
      // Anything but the exact echo, the popup's refusal included, fails the attempt.
      if (!isExactHandshake(ack.data, connectionId) || ack.ports.length !== 0) {
        dropPending()
        handlers.onFail()
        return
      }
      clearTimeout(lapse)
      pending = null
      handlers.onPending?.(false)
      port.onmessage = null
      handlers.onPort(port, event.origin)
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
export function requestApplicationPort(options: RequestOptions): Promise<PortCarrier | null> {
  const { view, opener, allowedOrigins, connectionId, signal } = options
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, port: PortCarrier | null = null): void => {
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
        // Answer a single-port response rather than leave the application waiting.
        if (event.ports.length === 1) {
          try {
            event.ports[0].postMessage(refusal(connectionId))
          } catch {
            // A port that cannot carry the refusal only closes.
          }
        }
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
      finish(null, new PortCarrier(port, event.origin))
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
  /** Whether handlers were ever installed; assigning them starts the port. */
  private started = false

  /**
   * `backlog` holds values a predecessor document received after it chose to
   * leave; they precede everything still queued in the port.
   */
  constructor(
    port: MessagePort,
    readonly peerOrigin: string,
    private backlog: unknown[] = [],
  ) {
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
    this.started = true
    port.onmessage = (event: MessageEvent): void => handler(event.data)
    // A value that cannot be deserialized reaches routing as one that cannot be decoded.
    port.onmessageerror = (): void => handler(undefined)
    port.start()
    // A microtask still precedes every task that dispatches the port's own values.
    const backlog = this.backlog.splice(0)
    queueMicrotask(() => {
      for (const value of backlog) if (this.port === port) handler(value)
    })
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
    // Assigning handlers, even null, would start a port that never was.
    if (this.started) {
      port.onmessage = null
      port.onmessageerror = null
    }
    port.close()
  }

  /**
   * Surrenders the port and its backlog for preservation; this carrier is
   * closed afterwards. Nothing stops a started port, and an engine may drop
   * values it has already taken from the channel when the port is
   * transferred, so until the transfer whatever it still dispatches here
   * joins the backlog.
   */
  detach(): { port: MessagePort; backlog: unknown[] } {
    const port = this.port
    if (!port) throw new PopupError('send-unavailable')
    this.port = null
    const { backlog } = this
    if (this.started) {
      port.onmessage = (event: MessageEvent): void => void backlog.push(event.data)
      port.onmessageerror = (): void => void backlog.push(undefined)
    }
    return { port, backlog }
  }
}
