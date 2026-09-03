// The logical connection (docs/connection.md, docs/control.md): one
// application endpoint that may see several popup documents, and one popup
// endpoint per document. Both share registration, routing, and closure; the
// popup side additionally consumes the two reserved controls.

import {
  createReporter,
  type DiagnosticCode,
  type PopupDiagnostic,
  PopupError,
  type PopupErrorCode,
  type Reporter,
  reportUndeliverable,
} from './diagnostics.js'
import { activeWorker, PortKeeper } from './keeper.js'
import {
  type Carrier,
  type CarrierConstructor,
  decodeControl,
  isCanonicalHttpsUrl,
  isConnectionId,
  isReservedType,
  type Message,
  type MessageType,
  type Navigate,
  type OriginAllowlist,
  type PopupControl,
  requireOrigins,
  routingType,
} from './message.js'
import { listenForPopupPorts, PortCarrier, requestApplicationPort } from './port.js'
import { CurrentWindow, OpenedWindow, type PopupWindow } from './window.js'

/** How a logical connection ended. */
export type ConnectionEnd = { outcome: 'closed' } | { outcome: 'failed'; code: PopupErrorCode }

export interface PopupConnection<Out extends Message, In extends Message = Out> {
  /** Settles when this endpoint has selected its first carrier, or rejects if it failed first. */
  readonly ready: Promise<void>
  /** Settles exactly once, when the logical connection ends; never rejects. */
  readonly closed: Promise<ConnectionEnd>
  send(message: Out): void
  on<N extends In>(message: MessageType<N>, handler: (message: N) => void): () => void
  /** Continuity-preserving navigation between participating documents. */
  navigate(url: string): Promise<void>
  /**
   * Navigation to a non-participating document. The destination never
   * crosses any carrier: the application navigates its retained handle
   * directly and the popup replaces itself locally. The current carrier is
   * retired, not preserved.
   */
  navigateAway(url: string): Promise<void>
  close(): Promise<void>
}

export interface ConnectOptions {
  connectionId: string
  allowedPopupOrigins: readonly string[]
  fallback?: CarrierConstructor
  onDiagnostic?: (event: PopupDiagnostic) => void
}

export interface AcceptOptions {
  connectionId: string
  /** Explicit origins, or `'*'` for any canonical HTTPS origin the browser observed. */
  allowedApplicationOrigins: readonly string[] | '*'
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
    throw new TypeError('navigation requires a canonical absolute HTTPS URL without credentials')
  }
}

const stripFragment = (url: string): string => url.split('#', 1)[0]

interface Registration<In extends Message> {
  decode: (value: unknown) => In
  handler: (message: In) => void
}

/** Shared endpoint state: registrations, carrier subscription, lifecycle. */
abstract class Endpoint<Out extends Message, In extends Message>
  implements PopupConnection<Out, In>
{
  readonly ready: Promise<void>
  readonly closed: Promise<ConnectionEnd>
  protected readonly controller = new AbortController()
  protected carrier: Carrier | null = null
  protected ended = false
  private readonly registrations = new Map<string, Registration<In>>()
  private unsubscribe: (() => void) | null = null
  private readonly startedAt = performance.now()
  private resolveReady!: () => void
  private rejectReady!: (error: PopupError) => void
  private settleClosed!: (end: ConnectionEnd) => void

  protected constructor(protected readonly report: Reporter) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.closed = new Promise((resolve) => {
      this.settleClosed = resolve
    })
    // A consumer that only awaits `closed` must not see an unhandled rejection.
    this.ready.catch(() => {})
  }

  send(message: Out): void {
    if (isReservedType(message.type)) {
      throw new TypeError(`"${message.type}" is a reserved discriminator`)
    }
    this.transmit(message)
  }

  /** Sends over the active carrier; a carrier that rejects the value fails the connection. */
  protected transmit(value: Message): void {
    if (this.ended || !this.carrier) {
      this.report('send-unavailable')
      throw new PopupError('send-unavailable')
    }
    try {
      this.carrier.send(value)
    } catch (error) {
      this.fail('send-unavailable', true)
      throw error
    }
  }

  on<N extends In>(message: MessageType<N>, handler: (message: N) => void): () => void {
    const { type } = message
    if (isReservedType(type)) throw new TypeError(`"${type}" is a reserved discriminator`)
    if (this.registrations.has(type)) throw new TypeError(`"${type}" is already registered`)
    const registration: Registration<In> = {
      decode: (value) => message.decode(value),
      handler: handler as (message: In) => void,
    }
    this.registrations.set(type, registration)
    return () => {
      if (this.registrations.get(type) === registration) this.registrations.delete(type)
    }
  }

  abstract navigate(url: string): Promise<void>
  abstract navigateAway(url: string): Promise<void>
  abstract close(): Promise<void>

  /** Installs the selected carrier; the class is reported when it was chosen here. */
  protected install(carrier: Carrier, code?: DiagnosticCode): void {
    this.dropCarrier()
    this.carrier = carrier
    this.unsubscribe = carrier.on((value) => this.receive(value))
    if (code) this.report(code)
    this.resolveReady()
  }

  protected abstract onControl(control: PopupControl): void

  /**
   * Routes one inbound value. Transport-level rejection fails the
   * connection; an exception thrown by a caller handler is the caller's and
   * propagates to the event loop untouched.
   */
  private receive(value: unknown): void {
    if (this.ended) return
    const type = routingType(value)
    if (type === null) {
      this.fail('decode-rejected')
      return
    }
    if (isReservedType(type)) {
      const control = decodeControl(value as Record<string, unknown>)
      if (control) this.onControl(control)
      else this.fail('control-rejected')
      return
    }
    const registration = this.registrations.get(type)
    if (!registration) {
      this.fail('decode-rejected')
      return
    }
    let message: In
    try {
      message = registration.decode(value)
    } catch {
      this.fail('decode-rejected')
      return
    }
    registration.handler(message)
  }

  protected dropCarrier(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.carrier?.close()
    this.carrier = null
  }

  /**
   * Fails the connection closed. A failure reached through a caller
   * operation reports through that operation; any other is undeliverable
   * and gets the one sanitized console line.
   */
  protected fail(code: PopupErrorCode, viaOperation = false): void {
    if (this.ended) return
    if (viaOperation) this.report(code)
    else reportUndeliverable(this.report, code)
    this.end({ outcome: 'failed', code })
  }

  protected release(): void {
    if (this.ended) return
    this.end({ outcome: 'closed' })
  }

  private end(end: ConnectionEnd): void {
    this.ended = true
    this.controller.abort()
    this.dropCarrier()
    this.report(
      end.outcome === 'closed' ? 'connection-closed' : 'connection-failed',
      performance.now() - this.startedAt,
    )
    if (end.outcome === 'failed') this.rejectReady(new PopupError(end.code))
    this.settleClosed(end)
  }
}

class ApplicationEndpoint<Out extends Message, In extends Message> extends Endpoint<Out, In> {
  private readonly stopListening: () => void

  constructor(
    private readonly popup: OpenedWindow,
    options: ConnectOptions,
  ) {
    super(createReporter(options.onDiagnostic))
    const connectionId = requireConnectionId(options.connectionId)
    const allowedPopupOrigins = requireOrigins(options.allowedPopupOrigins, 'allowedPopupOrigins')
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
        allowedPopupOrigins,
        connectionId,
      },
      {
        onPort: (port) => this.install(new PortCarrier(port), 'carrier-message-port'),
        onFail: () => this.fail('handshake-rejected'),
      },
    )

    if (options.fallback) {
      // Armed exactly once for the logical connection; observed, never awaited.
      const { fallback } = options
      new Promise<Carrier>((resolve) => resolve(fallback(this.controller.signal))).then(
        (carrier) => {
          if (this.ended) carrier.close()
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
    if (this.ended) throw new PopupError('connection-closed')
    requireHttpsUrl(url, this.report)
    if (this.carrier) {
      const control: Navigate = { type: 'navigate', url }
      this.transmit(control)
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
    throw new PopupError('popup-unavailable')
  }

  async navigateAway(url: string): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    requireHttpsUrl(url, this.report)
    if (!this.popup.opened) return
    if (!this.popup.direct) {
      this.report('popup-unavailable')
      throw new PopupError('popup-unavailable')
    }
    // Retire the carrier; the window listener stays armed for the next
    // participating document.
    this.dropCarrier()
    this.popup.replace(url)
    this.report('control-direct')
  }

  async close(): Promise<void> {
    if (this.ended) return
    if (this.popup.direct) {
      this.popup.closeHandle()
    } else if (this.carrier) {
      try {
        this.carrier.send({ type: 'close-popup' })
      } catch {
        // A dead carrier cannot carry the control; local release still runs.
      }
    }
    this.release()
  }

  protected override release(): void {
    if (this.ended) return
    this.stopListening()
    super.release()
  }

  protected override fail(code: PopupErrorCode, viaOperation = false): void {
    if (this.ended) return
    this.stopListening()
    super.fail(code, viaOperation)
  }
}

class PopupEndpoint<Out extends Message, In extends Message> extends Endpoint<Out, In> {
  /** The first accepted control is terminal for this document. */
  private controlsDone = false
  private readonly connectionId: string

  constructor(
    private readonly popup: CurrentWindow,
    options: AcceptOptions,
  ) {
    super(createReporter(options.onDiagnostic))
    this.connectionId = requireConnectionId(options.connectionId)
    const allowedOrigins: OriginAllowlist =
      options.allowedApplicationOrigins === '*'
        ? '*'
        : requireOrigins(options.allowedApplicationOrigins, 'allowedApplicationOrigins')
    void this.select(allowedOrigins, options.fallback)
  }

  /**
   * Selects this document's one carrier: a preserved port, then the opener
   * handshake, then the fallback. Runs after construction returns, so
   * registrations the caller makes synchronously precede the first delivery.
   */
  private async select(
    allowedOrigins: OriginAllowlist,
    fallback: CarrierConstructor | undefined,
  ): Promise<void> {
    try {
      // A preserved port can only be held by an already active worker.
      const registration = await this.popup.registration()
      if (registration?.active) {
        const port = await new PortKeeper(registration.active).claim(this.connectionId)
        if (this.ended) return port?.close()
        if (port) return this.install(new PortCarrier(port), 'carrier-restored')
        this.report('claim-empty')
      }
      const opener = this.popup.opener
      if (opener) {
        const port = await requestApplicationPort({
          view: this.popup.view,
          opener,
          allowedOrigins,
          connectionId: this.connectionId,
          signal: this.controller.signal,
        })
        if (this.ended) return port?.close()
        if (port) return this.install(new PortCarrier(port), 'carrier-message-port')
        this.report('opener-timeout')
      }
      if (!fallback) return this.fail('fallback-unavailable', true)
      const carrier = await fallback(this.controller.signal)
      if (this.ended) return carrier.close()
      this.install(carrier, 'carrier-fallback')
    } catch (error) {
      if (this.ended) return
      this.fail(error instanceof PopupError ? error.code : 'fallback-failed', true)
    }
  }

  protected onControl(control: PopupControl): void {
    if (this.controlsDone) return
    this.controlsDone = true
    if (control.type === 'navigate') {
      void this.replaceDocument(control.url, false).catch(() => {})
    } else {
      this.closePopup()
    }
  }

  async navigate(url: string): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    requireHttpsUrl(url, this.report)
    if (stripFragment(url) === stripFragment(this.popup.view.location.href)) {
      // A fragment navigation keeps this document; there is nothing to preserve.
      throw new TypeError('navigation requires a different document')
    }
    if (this.controlsDone) throw new PopupError('popup-unavailable')
    this.controlsDone = true
    await this.replaceDocument(url, true)
  }

  async navigateAway(url: string): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    requireHttpsUrl(url, this.report)
    if (this.controlsDone) throw new PopupError('popup-unavailable')
    this.controlsDone = true
    this.release()
    this.popup.view.location.replace(url)
  }

  async close(): Promise<void> {
    if (this.ended) return
    this.closePopup()
  }

  /**
   * Replaces this document. A same-origin target keeps the port through the
   * worker first; a cross-origin target cannot, so the endpoint retires and
   * the destination authenticates a fresh carrier through its opener or
   * fallback. Failure is reported through the invoking operation when there
   * is one, otherwise as undeliverable.
   */
  private async replaceDocument(url: string, viaOperation: boolean): Promise<void> {
    const { location } = this.popup.view
    if (new URL(url).origin !== location.origin) {
      this.release()
      location.replace(url)
      return
    }
    const failed = (code: PopupErrorCode): never => {
      this.fail(code, viaOperation)
      throw new PopupError(code)
    }
    const registration = await this.popup.registration()
    const worker = registration ? await activeWorker(registration) : null
    if (this.ended) throw new PopupError('connection-closed')
    if (!(this.carrier instanceof PortCarrier) || !worker) return failed('continuity-unsupported')
    const port = this.carrier.detach()
    const startedAt = performance.now()
    try {
      await new PortKeeper(worker).keep(this.connectionId, port)
    } catch {
      port.close() // a no-op once transferred; releases a port the worker never took
      return failed('keep-failed')
    }
    if (this.ended) throw new PopupError('connection-closed')
    this.report('keep-acknowledged', performance.now() - startedAt)
    location.replace(url)
  }

  private closePopup(): void {
    this.release()
    this.popup.view.close()
  }
}

export const PopupConnection = {
  connect<Out extends Message, In extends Message = Out>(
    popupWindow: PopupWindow,
    options: ConnectOptions,
  ): PopupConnection<Out, In> {
    if (!(popupWindow instanceof OpenedWindow)) {
      throw new TypeError('connect requires the PopupWindow returned by PopupWindow.open')
    }
    return new ApplicationEndpoint<Out, In>(popupWindow, options)
  },

  /**
   * Constructs the popup endpoint synchronously so handlers registered before
   * the caller yields precede every delivery; `ready` settles once a carrier
   * is selected.
   */
  accept<Out extends Message, In extends Message = Out>(
    popupWindow: PopupWindow,
    options: AcceptOptions,
  ): PopupConnection<Out, In> {
    if (!(popupWindow instanceof CurrentWindow)) {
      throw new TypeError('accept requires the PopupWindow returned by PopupWindow.current')
    }
    return new PopupEndpoint<Out, In>(popupWindow, options)
  },
}
