// The logical connection (docs/connection.md, docs/control.md): one
// application endpoint that may see several popup documents, and one popup
// endpoint per document. Both share the handler registry; the popup side
// additionally consumes the two reserved controls.

import {
  codeOf,
  createReporter,
  type DiagnosticCode,
  failure,
  type PopupDiagnostic,
  type Reporter,
  reportUndeliverable,
} from './diagnostics.js'
import { PortKeeper } from './keeper.js'
import {
  canonicalOrigin,
  type Carrier,
  type CarrierConstructor,
  decodeControl,
  isCanonicalHttpsUrl,
  isConnectionId,
  isReservedType,
  type Message,
  type MessageType,
  type Navigate,
  type PopupControl,
  routingType,
} from './message.js'
import {
  listenForPopupPorts,
  OPENER_HANDSHAKE_TIMEOUT_MS,
  PortCarrier,
  requestApplicationPort,
} from './port.js'
import { CurrentWindow, OpenedWindow, type PopupWindow } from './window.js'

export interface PopupConnection<M extends Message> {
  send(message: M): void
  on<N extends M>(message: MessageType<N>, handler: (message: N) => void): () => void
  navigate(url: string): Promise<void>
  close(): Promise<void>
}

export interface ConnectOptions {
  connectionId: string
  popupOrigin: string
  fallback?: CarrierConstructor
  onDiagnostic?: (event: PopupDiagnostic) => void
}

export interface AcceptOptions {
  connectionId: string
  allowedApplicationOrigins: readonly string[]
  fallback?: CarrierConstructor
  onDiagnostic?: (event: PopupDiagnostic) => void
}

function requireConnectionId(value: string): string {
  if (!isConnectionId(value)) {
    throw new TypeError('connectionId must be a canonical lowercase RFC 4122 UUIDv4')
  }
  return value
}

function requireHttpsUrl(url: string, report: Reporter): void {
  if (!isCanonicalHttpsUrl(url)) {
    report('control-rejected')
    throw new TypeError('navigate requires a canonical absolute HTTPS URL without credentials')
  }
}

/** Caller registrations plus routing of every inbound carrier value. */
class Handlers<M extends Message> {
  private readonly entries = new Map<
    string,
    { decode: (value: unknown) => M; handler: (message: M) => void }
  >()

  on<N extends M>(message: MessageType<N>, handler: (message: N) => void): () => void {
    const { type } = message
    if (isReservedType(type)) throw new TypeError(`"${type}" is a reserved discriminator`)
    if (this.entries.has(type)) throw new TypeError(`"${type}" is already registered`)
    const entry = { decode: (value: unknown) => message.decode(value), handler }
    this.entries.set(type, entry as never)
    return () => {
      if (this.entries.get(type) === (entry as never)) this.entries.delete(type)
    }
  }

  /**
   * Dispatches one caller value, or returns a decoded control for the
   * endpoint. Throws `decode-rejected` or `control-rejected` otherwise.
   */
  deliver(value: unknown): PopupControl | null {
    const type = routingType(value)
    if (type === null) throw failure('decode-rejected')
    if (isReservedType(type)) {
      const control = decodeControl(value as Record<string, unknown>)
      if (!control) throw failure('control-rejected')
      return control
    }
    const entry = this.entries.get(type)
    if (!entry) throw failure('decode-rejected')
    let message: M
    try {
      message = entry.decode(value)
    } catch {
      throw failure('decode-rejected')
    }
    entry.handler(message)
    return null
  }
}

/** Shared endpoint state: registry, carrier subscription, closure. */
abstract class Endpoint<M extends Message> implements PopupConnection<M> {
  protected readonly handlers = new Handlers<M>()
  protected readonly controller = new AbortController()
  protected carrier: Carrier | null = null
  protected closed = false
  private unsubscribe: (() => void) | null = null
  private readonly startedAt = performance.now()

  protected constructor(protected readonly report: Reporter) {}

  send(message: M): void {
    if (isReservedType(message.type)) {
      throw new TypeError(`"${message.type}" is a reserved discriminator`)
    }
    if (this.closed || !this.carrier) {
      this.report('send-unavailable')
      throw failure('send-unavailable')
    }
    this.carrier.send(message)
  }

  on<N extends M>(message: MessageType<N>, handler: (message: N) => void): () => void {
    return this.handlers.on(message, handler)
  }

  abstract navigate(url: string): Promise<void>
  abstract close(): Promise<void>

  /** Installs the selected carrier; the class is reported when it was chosen here. */
  protected install(carrier: Carrier, code?: DiagnosticCode): void {
    this.dropCarrier()
    this.carrier = carrier
    this.unsubscribe = carrier.on((value) => this.receive(value))
    if (code) this.report(code)
  }

  protected abstract onControl(control: PopupControl): void

  private receive(value: unknown): void {
    if (this.closed) return
    let control: PopupControl | null
    try {
      control = this.handlers.deliver(value)
    } catch (error) {
      this.fail(codeOf(error) ?? 'decode-rejected')
      return
    }
    if (control) this.onControl(control)
  }

  protected dropCarrier(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.carrier?.close()
    this.carrier = null
  }

  protected fail(code: DiagnosticCode): void {
    if (this.closed) return
    this.release('connection-failed')
    reportUndeliverable(this.report, code)
  }

  protected release(code: 'connection-closed' | 'connection-failed'): void {
    this.closed = true
    this.controller.abort()
    this.dropCarrier()
    this.report(code, { durationMs: performance.now() - this.startedAt })
  }
}

class ApplicationEndpoint<M extends Message> extends Endpoint<M> {
  private readonly stopListening: () => void

  constructor(
    private readonly popup: OpenedWindow,
    options: ConnectOptions,
  ) {
    super(createReporter(options.onDiagnostic))
    const connectionId = requireConnectionId(options.connectionId)
    const popupOrigin = canonicalOrigin(options.popupOrigin)
    if (!popupOrigin) throw new TypeError('popupOrigin must be a canonical origin')
    if (popup.connected) throw new Error('PopupWindow is already connected')
    popup.connected = true

    this.report(popup.opened ? 'window-opened' : 'window-blocked')
    this.stopListening = listenForPopupPorts(
      {
        view: popup.view,
        source: popup.handle,
        onBind: (source) => {
          popup.bind(source)
          this.report('window-bound')
        },
        popupOrigin,
        connectionId,
        report: this.report,
      },
      {
        onPort: (port) => this.install(new PortCarrier(port), 'carrier-message-port'),
        onFail: () => this.fail('handshake-rejected'),
      },
    )

    if (options.fallback) {
      // Armed exactly once for the logical connection; observed, never awaited.
      let pending: Promise<Carrier>
      try {
        pending = Promise.resolve(options.fallback(this.controller.signal))
      } catch (error) {
        pending = Promise.reject(error)
      }
      pending.then(
        (carrier) => {
          if (this.closed) carrier.close()
          else this.install(carrier, 'carrier-fallback')
        },
        () => {
          // A rejected standby is silent unless its path was selected.
        },
      )
    }
  }

  protected onControl(): void {
    // Controls are application-to-popup only.
    this.fail('control-rejected')
  }

  async navigate(url: string): Promise<void> {
    if (this.closed) throw failure('connection-closed')
    requireHttpsUrl(url, this.report)
    if (this.carrier) {
      const control: Navigate = { type: 'navigate', url }
      this.carrier.send(control)
      this.report('control-connected')
      return
    }
    if (this.popup.direct) {
      this.popup.replace(url)
      this.report('control-direct')
      return
    }
    // Native-anchor binding pending: the activation's own navigation proceeds.
    if (!this.popup.opened) return
    this.report('popup-unavailable')
    throw failure('popup-unavailable')
  }

  async close(): Promise<void> {
    if (this.closed) return
    if (this.popup.direct) {
      this.popup.closeHandle()
    } else if (this.carrier) {
      try {
        this.carrier.send({ type: 'close-popup' })
      } catch {
        // A dead carrier cannot carry the control; local release still runs.
      }
    }
    this.release('connection-closed')
  }

  protected override release(code: 'connection-closed' | 'connection-failed'): void {
    this.stopListening()
    super.release(code)
  }
}

class PopupEndpoint<M extends Message> extends Endpoint<M> {
  /** The first accepted control is terminal for this document. */
  private controlsDone = false

  private constructor(
    private readonly popup: CurrentWindow,
    private readonly connectionId: string,
    private readonly keeper: PortKeeper | null,
    report: Reporter,
  ) {
    super(report)
  }

  static async accept<M extends Message>(
    popup: CurrentWindow,
    options: AcceptOptions,
  ): Promise<PopupEndpoint<M>> {
    const report = createReporter(options.onDiagnostic)
    const connectionId = requireConnectionId(options.connectionId)
    const origins = options.allowedApplicationOrigins
    if (!Array.isArray(origins) || origins.length === 0) {
      throw new TypeError('allowedApplicationOrigins must list at least one origin')
    }
    const allowedOrigins = Object.freeze([...new Set(origins.map(canonicalOrigin))])
    if (allowedOrigins.some((origin) => origin === null)) {
      throw new TypeError('allowedApplicationOrigins must contain canonical origins')
    }

    const controller = new AbortController()
    let keeper: PortKeeper | null = null
    let carrier: Carrier | null = null

    const registration = await popup.registration
    if (registration?.active) {
      keeper = new PortKeeper(registration.active)
      const port = await keeper.claim(connectionId).catch((error: unknown) => {
        report('claim-failed')
        throw error
      })
      if (port) {
        carrier = new PortCarrier(port)
        report('carrier-restored')
      } else {
        report('claim-empty')
      }
    }

    if (!carrier) {
      const opener = popup.opener
      if (opener) {
        try {
          const port = await requestApplicationPort({
            view: popup.view,
            opener,
            allowedOrigins: allowedOrigins as string[],
            connectionId,
            signal: controller.signal,
            timeoutMs: OPENER_HANDSHAKE_TIMEOUT_MS,
          })
          carrier = new PortCarrier(port)
          report('carrier-message-port')
        } catch (error) {
          const code = codeOf(error)
          if (code !== 'opener-timeout') {
            report('handshake-rejected')
            throw error
          }
          report('opener-timeout')
        }
      }
    }

    if (!carrier) {
      if (!options.fallback) {
        report('fallback-unavailable')
        throw failure('fallback-unavailable')
      }
      carrier = await options.fallback(controller.signal)
      report('carrier-fallback')
    }

    const endpoint = new PopupEndpoint<M>(popup, connectionId, keeper, report)
    endpoint.install(carrier)
    return endpoint
  }

  protected onControl(control: PopupControl): void {
    if (this.controlsDone) return
    this.controlsDone = true
    if (control.type === 'navigate') {
      void this.replaceDocument(control.url).catch(() => {})
    } else {
      this.closePopup('connection-closed')
    }
  }

  async navigate(url: string): Promise<void> {
    if (this.closed) throw failure('connection-closed')
    requireHttpsUrl(url, this.report)
    if (this.controlsDone) throw failure('popup-unavailable')
    this.controlsDone = true
    await this.replaceDocument(url)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closePopup('connection-closed')
  }

  /** Preserves the port through the keeper, then replaces this document. */
  private async replaceDocument(url: string): Promise<void> {
    if (!(this.carrier instanceof PortCarrier) || !this.keeper) {
      this.fail('continuity-unsupported')
      throw failure('continuity-unsupported')
    }
    const port = this.carrier.detach()
    const startedAt = performance.now()
    try {
      await this.keeper.keep(this.connectionId, port)
    } catch {
      this.fail('keep-failed')
      throw failure('keep-failed')
    }
    this.report('keep-acknowledged', { durationMs: performance.now() - startedAt })
    this.popup.view.location.replace(url)
  }

  private closePopup(code: 'connection-closed'): void {
    this.release(code)
    this.popup.view.close()
  }
}

export const PopupConnection = {
  connect<M extends Message>(
    popupWindow: PopupWindow,
    options: ConnectOptions,
  ): PopupConnection<M> {
    if (!(popupWindow instanceof OpenedWindow)) {
      throw new TypeError('connect requires the PopupWindow returned by PopupWindow.open')
    }
    return new ApplicationEndpoint<M>(popupWindow, options)
  },

  accept<M extends Message>(
    popupWindow: PopupWindow,
    options: AcceptOptions,
  ): Promise<PopupConnection<M>> {
    if (!(popupWindow instanceof CurrentWindow)) {
      return Promise.reject(
        new TypeError('accept requires the PopupWindow returned by PopupWindow.current'),
      )
    }
    return PopupEndpoint.accept<M>(popupWindow, options)
  },
}
