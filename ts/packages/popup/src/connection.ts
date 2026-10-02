// The logical connection (docs/connection.md, docs/control.md): one
// application endpoint that may see several popup documents, and one popup
// endpoint per document. Both share handler routes and closure; the
// popup side consumes navigation/close controls and reports document departure.

import {
  createReporter,
  type DiagnosticCode,
  type PopupDiagnostic,
  PopupError,
  type PopupErrorCode,
  type Reporter,
  reportUndeliverable,
} from './diagnostics.js'
import { activeRegistration, depart, PortKeeper } from './keeper.js'
import {
  type Carrier,
  type CarrierConstructor,
  DEPARTED,
  decodeControl,
  isAllowedOrigin,
  isCanonicalWebUrl,
  isConnectionId,
  isNavigationCarrier,
  isReservedType,
  MAX_TYPE_LENGTH,
  type Message,
  type MessageType,
  type Navigate,
  type OriginAllowlist,
  onReplacement,
  type PopupControl,
  prepareNavigation,
  requireOrigins,
  routingType,
} from './message.js'
import { listenForPopupPorts, PortCarrier, requestApplicationPort } from './port.js'
import { CurrentWindow, OpenedWindow, type PopupWindow } from './window.js'

/** How a logical connection ended. */
export type ConnectionEnd = { outcome: 'closed' } | { outcome: 'failed'; code: PopupErrorCode }

export interface PopupConnection<Out extends Message, In extends Message = Out> {
  /** The logical connection's UUID, which both endpoints were given. */
  readonly connectionId: string
  /**
   * Settles when this endpoint has selected its first carrier, or rejects if it failed first.
   * The application's also rejects with `connection-closed` if it ends closed first.
   */
  readonly ready: Promise<void>
  /**
   * Settles once on explicit close, reported document departure, or detected failure.
   * Never rejects. An unreachable handle fails only without a carrier or pending recovery.
   * Silence alone does not establish closure.
   */
  readonly closed: Promise<ConnectionEnd>
  /** Authenticated peer of the selected carrier; null before selection or after retirement. */
  readonly peerOrigin: string | null
  send(message: Out): void
  on<N extends In>(message: MessageType<N>, handler: (message: N) => void): () => void
  /**
   * Continuity-preserving navigation between participating documents. `url`
   * carries no fragment; `fragment` supplies one as opaque protocol data,
   * serialized at the call.
   */
  navigate(url: string, fragment?: URLSearchParams): Promise<void>
  /**
   * Navigation to a non-participating document. The destination never
   * crosses any carrier: the application navigates its retained handle
   * directly and the popup replaces itself locally. The current carrier is
   * retired, not preserved.
   */
  navigateAway(url: string, fragment?: URLSearchParams): Promise<void>
  close(): Promise<void>
}

export interface ConnectOptions {
  connectionId: string
  allowedPopupOrigins: OriginAllowlist
  /** Armed once; pending recovery survives handle loss without a connection-layer timeout. */
  fallback?: CarrierConstructor
  onDiagnostic?: (event: PopupDiagnostic) => void
}

export interface AcceptOptions {
  connectionId: string
  /** Admission patterns; the selected peer is always bound to its exact origin. */
  allowedApplicationOrigins: OriginAllowlist
  /**
   * Requires cross-origin isolation. A non-isolated document preserves an
   * available MessagePort through the worker, or defers the fallback
   * constructor until after replacement. The same-origin destination resolves against
   * the current document and inherits its captured fragment; it must not
   * spell a fragment itself.
   */
  isolationFallbackUrl?: string
  fallback?: CarrierConstructor
  onDiagnostic?: (event: PopupDiagnostic) => void
}

function requireConnectionId(value: string): string {
  if (!isConnectionId(value)) {
    throw new TypeError('connectionId must be a canonical lowercase RFC 4122 UUIDv4')
  }
  return value
}

/**
 * The navigation target from a fragment-free URL and optional opaque
 * parameters, serialized now so later mutation of `fragment` is invisible.
 */
function destination(url: string, fragment: URLSearchParams | undefined, report: Reporter): string {
  if (!isCanonicalWebUrl(url) || url.includes('#')) {
    report('control-rejected')
    throw new TypeError(
      'navigation requires a canonical absolute HTTPS (or localhost HTTP) URL without credentials or fragment',
    )
  }
  const serialized = fragment?.toString() ?? ''
  return serialized === '' ? url : `${url}#${serialized}`
}

/** Same origin, path, and query; fragments do not distinguish documents. */
const sameDocument = (url: URL, location: Location): boolean =>
  url.origin === location.origin &&
  url.pathname === location.pathname &&
  url.search === location.search

/** The same-origin HTTPS (or localhost HTTP) isolation fallback, carrying the captured fragment. */
function resolveIsolationFallback(value: string, location: Location, fragment: string): URL {
  let url: URL
  try {
    url = new URL(value, location.href)
  } catch {
    throw new TypeError('isolationFallbackUrl must be a URL')
  }
  if (!isCanonicalWebUrl(url.href) || url.origin !== location.origin || value.includes('#')) {
    throw new TypeError(
      'isolationFallbackUrl must be a same-origin HTTPS (or localhost HTTP) URL without fragment',
    )
  }
  url.hash = fragment
  return url
}

/** A caller type the peer's routing accepts: bounded and not a reserved control. */
function requireRoutable(type: string): void {
  if (isReservedType(type)) throw new TypeError(`"${type}" is a reserved discriminator`)
  if (routingType({ type }) !== type) {
    throw new TypeError(`message type must be 1 to ${MAX_TYPE_LENGTH} characters`)
  }
}

interface Route<In extends Message> {
  decode: (value: unknown) => In
  handler: (message: In) => void
}

/** Shared endpoint state: handler routes, carrier subscription, lifecycle. */
abstract class Endpoint<Out extends Message, In extends Message>
  implements PopupConnection<Out, In>
{
  readonly ready: Promise<void>
  readonly closed: Promise<ConnectionEnd>
  protected readonly controller = new AbortController()
  protected carrier: Carrier | null = null
  protected ended = false
  private readonly routes = new Map<string, Route<In>>()
  private boundOrigin: string | null = null
  private unsubscribe: (() => void) | null = null
  private readonly startedAt = performance.now()
  private resolveReady!: () => void
  private rejectReady!: (error: PopupError) => void
  private settleClosed!: (end: ConnectionEnd) => void

  /**
   * @param closedRejectsReady whether ending closed before selection rejects
   * `ready`; a popup document replacing itself leaves readiness to its successor.
   */
  protected constructor(
    protected readonly report: Reporter,
    private readonly allowedOrigins: OriginAllowlist,
    private readonly closedRejectsReady: boolean,
    readonly connectionId: string,
  ) {
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

  get peerOrigin(): string | null {
    return this.boundOrigin
  }

  send(message: Out): void {
    requireRoutable(message.type)
    this.transmit(message)
  }

  /**
   * Sends over the active carrier; a carrier that rejects the value fails the
   * connection. An ended endpoint throws `connection-closed`, as every other
   * operation does.
   */
  protected transmit(value: Message): void {
    if (this.ended) throw new PopupError('connection-closed')
    if (!this.carrier) {
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
    requireRoutable(type)
    if (this.routes.has(type)) throw new TypeError(`"${type}" is already registered`)
    const route: Route<In> = {
      decode: (value) => message.decode(value),
      handler: handler as (message: In) => void,
    }
    this.routes.set(type, route)
    return () => {
      if (this.routes.get(type) === route) this.routes.delete(type)
    }
  }

  abstract navigate(url: string, fragment?: URLSearchParams): Promise<void>
  abstract navigateAway(url: string, fragment?: URLSearchParams): Promise<void>
  abstract close(): Promise<void>

  /** Installs the selected carrier; the class is reported when it was chosen here. */
  protected install(carrier: Carrier, code?: DiagnosticCode): void {
    if (!this.checkPeer(carrier)) return
    this.dropCarrier()
    this.carrier = carrier
    this.boundOrigin = carrier.peerOrigin
    this.unsubscribe = carrier.on((value) => {
      if (this.carrier === carrier) this.receive(value)
    })
    if (code) this.report(code)
    this.resolveReady()
  }

  /** Rejects an invalid binding before either delivery or isolation handoff. */
  protected checkPeer(carrier: Carrier): boolean {
    if (isAllowedOrigin(carrier.peerOrigin, this.allowedOrigins)) return true
    this.discard(carrier)
    this.fail('handshake-rejected')
    return false
  }

  /** Closes a carrier this endpoint will not use. */
  protected discard(carrier: Carrier): void {
    carrier.close()
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
    const route = this.routes.get(type)
    if (!route) {
      this.fail('decode-rejected')
      return
    }
    let message: In
    try {
      message = route.decode(value)
    } catch {
      this.fail('decode-rejected')
      return
    }
    route.handler(message)
  }

  protected dropCarrier(): void {
    this.boundOrigin = null
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
    else if (this.closedRejectsReady) this.rejectReady(new PopupError('connection-closed'))
    this.settleClosed(end)
  }
}

class ApplicationEndpoint<Out extends Message, In extends Message> extends Endpoint<Out, In> {
  private readonly stopListening: () => void
  private stopReplacement: (() => void) | null = null
  private fallbackPending: boolean
  private handshakePending = false

  constructor(
    private readonly popup: OpenedWindow,
    options: ConnectOptions,
  ) {
    const allowedPopupOrigins = requireOrigins(options.allowedPopupOrigins, 'allowedPopupOrigins')
    const connectionId = requireConnectionId(options.connectionId)
    super(createReporter(options.onDiagnostic), allowedPopupOrigins, true, connectionId)
    if (popup.connected) throw new Error('PopupWindow is already connected')
    popup.connected = true
    this.fallbackPending = options.fallback !== undefined

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
        onPort: (port, peerOrigin) =>
          this.install(new PortCarrier(port, peerOrigin), 'carrier-message-port'),
        onFail: () => this.fail('handshake-rejected'),
        onPending: (pending) => {
          this.handshakePending = pending
        },
      },
    )

    // Provider pages cannot report departure. A closed handle also means COOP
    // severance, so fail only when neither a carrier nor recovery is available.
    const poll = setInterval(() => this.checkWindow(), 250)
    this.controller.signal.addEventListener('abort', () => clearInterval(poll), { once: true })

    if (options.fallback) {
      // Armed exactly once for the logical connection; observed, never awaited.
      const { fallback } = options
      new Promise<Carrier>((resolve) => resolve(fallback(this.controller.signal))).then(
        (carrier) => {
          this.fallbackPending = false
          if (this.ended) carrier.close()
          else this.install(carrier, 'carrier-fallback')
        },
        () => {
          // Losing standby alone is harmless while the opener/carrier still works.
          this.fallbackPending = false
          this.checkWindow()
        },
      )
    }
  }

  private checkWindow(): void {
    if (this.ended || this.carrier || this.fallbackPending || this.handshakePending) return
    // Native-anchor creation has no handle until the first authenticated binding.
    if (this.popup.opened && !this.popup.direct) this.fail('popup-unavailable')
  }

  protected onControl(control: PopupControl): void {
    if (control.type === 'document-departed') this.release()
    else this.fail('control-rejected')
  }

  /**
   * A carrier that cannot cross a document replacement reports its own
   * replacement, prepared by the popup before it navigated; the application
   * installs the authenticated result under the same logical connection.
   */
  protected override install(carrier: Carrier, code?: DiagnosticCode): void {
    super.install(carrier, code)
    if (this.ended || !isNavigationCarrier(carrier)) return
    this.stopReplacement = carrier[onReplacement]((pending) => {
      pending.then(
        (next) => {
          if (this.ended || this.carrier !== carrier) next.close()
          else this.install(next, 'carrier-fallback')
        },
        () => {
          // A failed replacement leaves the previous carrier in place; the
          // destination reports the failure through its own readiness.
        },
      )
    })
  }

  protected override dropCarrier(): void {
    this.stopReplacement?.()
    this.stopReplacement = null
    super.dropCarrier()
  }

  async navigate(url: string, fragment?: URLSearchParams): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    const target = destination(url, fragment, this.report)
    if (this.carrier) {
      const control: Navigate = { type: 'navigate', url: target }
      this.transmit(control)
      this.report('control-connected')
      return
    }
    if (this.popup.direct) {
      this.popup.replace(target)
      this.report('control-direct')
      return
    }
    // Native-anchor binding pending: the activation's own navigation proceeds, here.
    if (!this.popup.opened) {
      this.popup.pointAnchor(target)
      return
    }
    this.report('popup-unavailable')
    throw new PopupError('popup-unavailable')
  }

  async navigateAway(url: string, fragment?: URLSearchParams): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    const target = destination(url, fragment, this.report)
    if (!this.popup.opened) {
      this.popup.pointAnchor(target)
      return
    }
    if (!this.popup.direct) {
      this.report('popup-unavailable')
      throw new PopupError('popup-unavailable')
    }
    // Retire the carrier; the window listener stays armed for the next
    // participating document.
    this.dropCarrier()
    this.popup.replace(target)
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
  /**
   * Set once this document accepts a control or starts leaving; it then
   * takes no further control, and its own navigation throws `popup-unavailable`.
   */
  private leaving = false
  /** A port on its way to the worker; closure before the transfer must still report departure. */
  private handoff: MessagePort | null = null
  private readonly isolationFallback: URL | null

  constructor(
    private readonly popup: CurrentWindow,
    options: AcceptOptions,
  ) {
    const allowedOrigins = requireOrigins(
      options.allowedApplicationOrigins,
      'allowedApplicationOrigins',
    )
    super(
      createReporter(options.onDiagnostic),
      allowedOrigins,
      false,
      requireConnectionId(options.connectionId),
    )
    this.isolationFallback =
      options.isolationFallbackUrl === undefined
        ? null
        : resolveIsolationFallback(
            options.isolationFallbackUrl,
            popup.view.location,
            popup.fragment,
          )
    const onPageHide = () => {
      if (this.handoff) {
        // Closed before the worker took the port.
        depart(this.handoff)
        this.handoff = null
        return this.release()
      }
      if (this.ended || this.leaving) return
      this.depart()
    }
    // WebKit otherwise skips pagehide when closing a window. This listener never
    // prompts or reports departure; a beforeunload can still be cancelled.
    const beforeUnload = () => {}
    popup.view.addEventListener('beforeunload', beforeUnload, { signal: this.controller.signal })
    popup.view.addEventListener('pagehide', onPageHide, { signal: this.controller.signal })
    void this.select(allowedOrigins, options.fallback)
  }

  /**
   * Selects this document's one carrier: a preserved port, then the opener
   * handshake, then the fallback constructor. Runs after construction
   * returns, so handlers the caller registers synchronously precede the
   * first delivery.
   */
  private async select(
    allowedOrigins: OriginAllowlist,
    fallback: CarrierConstructor | undefined,
  ): Promise<void> {
    try {
      // A preserved port can only be held by an already active worker.
      const workers = (await this.popup.registrations()).flatMap((r) => r.active ?? [])
      if (workers.length > 0) {
        const port = await this.claimFrom(workers)
        if (this.ended) return port ? this.discard(port) : undefined
        if (port) return this.admit(port, 'carrier-restored')
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
        if (this.ended) return port ? this.discard(port) : undefined
        if (port) return this.admit(port, 'carrier-message-port')
        this.report('opener-timeout')
      }
      if (!fallback) return this.fail('fallback-unavailable', true)
      if (this.isolationFallback && !this.popup.isolated) {
        if (this.ended) return
        // Nothing exists to preserve yet, so the hop precedes the carrier:
        // the destination establishes the only one from the same still-
        // unused round, and no connection is spent on this document.
        if (sameDocument(this.isolationFallback, this.popup.view.location)) {
          return this.fail('isolation-unavailable', true)
        }
        this.report('isolation-fallback')
        this.release()
        this.popup.view.location.replace(this.isolationFallback.href)
        return
      }
      const carrier = await fallback(this.controller.signal)
      if (this.ended) return this.discard(carrier)
      return this.install(carrier, 'carrier-fallback')
    } catch (error) {
      if (this.ended) return
      this.fail(error instanceof PopupError ? error.code : 'fallback-failed', true)
    }
  }

  /**
   * Asks every worker at once; at most one holds this connection's port. A
   * malformed answer fails the claim, and any port another worker returned
   * then reports departure rather than leak.
   */
  private async claimFrom(workers: ServiceWorker[]): Promise<PortCarrier | null> {
    const answers = await Promise.allSettled(
      workers.map((w) => new PortKeeper(w).claim(this.connectionId)),
    )
    const claimed = answers.flatMap((a) => (a.status === 'fulfilled' && a.value ? [a.value] : []))
    if (answers.some((a) => a.status === 'rejected')) {
      for (const { port } of claimed) depart(port)
      throw new PopupError('claim-failed')
    }
    const [first, ...extra] = claimed
    for (const { port } of extra) port.close()
    return first ? new PortCarrier(first.port, first.peerOrigin, first.backlog) : null
  }

  /**
   * Installs an authenticated port, unless this document must be isolated
   * and is not: then the port, still unstarted so every value the
   * application already sent stays queued inside it, is kept through the
   * worker and the document replaces itself with the isolation fallback,
   * where the port continues. `ready` stays pending here; the replacement
   * becomes ready instead.
   */
  private async admit(
    carrier: PortCarrier,
    code: 'carrier-restored' | 'carrier-message-port',
  ): Promise<void> {
    const { location } = this.popup.view
    if (!this.isolationFallback || this.popup.isolated) return this.install(carrier, code)
    if (!this.checkPeer(carrier)) return
    this.report(code)
    if (sameDocument(this.isolationFallback, location)) {
      // Already the isolation fallback and still not isolated: the host's
      // policy is not taking effect. Never loop, and end the application's
      // side too, which would otherwise keep waiting on this carrier.
      this.discard(carrier)
      return this.fail('isolation-unavailable', true)
    }
    this.leaving = true
    this.report('isolation-fallback')
    this.carrier = carrier // retired by release(), never started for delivery
    try {
      await this.leaveFor(this.isolationFallback.href, true)
    } catch {
      // already failed through `ready`
    }
  }

  protected onControl(control: PopupControl): void {
    if (control.type === 'document-departed') {
      this.fail('control-rejected')
      return
    }
    if (this.leaving) return
    this.leaving = true
    if (control.type === 'close-popup') {
      this.closePopup()
    } else if (sameDocument(new URL(control.url), this.popup.view.location)) {
      // A fragment navigation keeps this document, so no destination would take the port.
      if (this.carrier) this.discard(this.carrier)
      this.fail('control-rejected')
    } else {
      void this.replaceDocument(control.url, false).catch(() => {})
    }
  }

  async navigate(url: string, fragment?: URLSearchParams): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    const target = destination(url, fragment, this.report)
    if (sameDocument(new URL(url), this.popup.view.location)) {
      // A fragment navigation keeps this document; there is nothing to preserve.
      throw new TypeError('navigation requires a different document')
    }
    if (this.leaving) throw new PopupError('popup-unavailable')
    this.leaving = true
    // Acts locally: the destination and its fragment reach no control,
    // diagnostic, or signal.
    await this.replaceDocument(target, true)
  }

  async navigateAway(url: string, fragment?: URLSearchParams): Promise<void> {
    if (this.ended) throw new PopupError('connection-closed')
    const target = destination(url, fragment, this.report)
    if (this.leaving) throw new PopupError('popup-unavailable')
    this.leaving = true
    this.release()
    this.popup.view.location.replace(target)
  }

  async close(): Promise<void> {
    if (this.ended) return
    this.closePopup()
  }

  /**
   * Replaces this document. A same-origin target keeps the port through the
   * worker first; a cross-origin target cannot, so the endpoint releases and
   * the destination authenticates a fresh carrier through its opener or
   * fallback constructor. Failure is reported through the invoking operation
   * when there is one, otherwise as undeliverable.
   */
  private async replaceDocument(url: string, viaOperation: boolean): Promise<void> {
    const { location } = this.popup.view
    const carrier = this.carrier
    if (new URL(url).origin !== location.origin && !(carrier && isNavigationCarrier(carrier))) {
      // Nothing crosses an origin: the destination authenticates afresh.
      this.release()
      location.replace(url)
      return
    }
    await this.leaveFor(url, viaOperation)
  }

  /**
   * Leaves this document for `url` with continuity: a port is kept through
   * the worker; a navigation carrier prepares its replacement first and is
   * then retired; any other carrier cannot continue. Failure is reported
   * through the invoking operation when there is one and rethrown.
   */
  private async leaveFor(url: string, viaOperation: boolean): Promise<void> {
    const { location } = this.popup.view
    const carrier = this.carrier
    if (carrier instanceof PortCarrier) {
      const peerOrigin = carrier.peerOrigin
      const { port, backlog } = carrier.detach()
      this.dropCarrier()
      await this.keepThrough(port, backlog, peerOrigin, url, viaOperation)
      this.release() // the port is the worker's now; this endpoint is done
      location.replace(url)
      return
    }
    if (!carrier || !isNavigationCarrier(carrier)) {
      this.fail('continuity-unsupported', viaOperation)
      throw new PopupError('continuity-unsupported')
    }
    let target: string
    try {
      target = await carrier[prepareNavigation](url)
    } catch {
      this.fail('continuity-unsupported', viaOperation)
      throw new PopupError('continuity-unsupported')
    }
    if (this.ended) throw new PopupError('connection-closed')
    // Release before leaving; nothing the application sends from here on
    // reaches a document until the destination authenticates its successor.
    this.release()
    location.replace(target)
  }

  /**
   * Hands one port to the worker for the next same-origin document at `url`.
   * Fails the endpoint and throws when no worker is active, the keep is
   * refused, or the connection ended meanwhile.
   */
  private async keepThrough(
    port: MessagePort,
    backlog: unknown[],
    peerOrigin: string,
    url: string,
    viaOperation: boolean,
  ): Promise<void> {
    const failed: (code: PopupErrorCode) => never = (code) => {
      // Before the worker takes the port, end the application's side here; the worker then
      // ends it only on a duplicate keep, and an expired port closes silently.
      this.handoff = null
      depart(port) // a no-op once transferred
      this.fail(code, viaOperation)
      throw new PopupError(code)
    }
    this.handoff = port
    // The registration that will control the destination is the one its
    // document claims from, whichever one controls this document. The host
    // may still be registering it here, so wait briefly for it to activate.
    const registration = await activeRegistration(
      async () => (await this.popup.registrations(url))[0],
    )
    const worker = registration?.active ?? null
    if (this.ended) failed('connection-closed')
    if (!worker) failed('continuity-unsupported')
    const startedAt = performance.now()
    try {
      // The transfer happens in this call, taking the backlog as it stands.
      const kept = new PortKeeper(worker).keep(this.connectionId, port, peerOrigin, backlog)
      this.handoff = null
      await kept
    } catch {
      failed('keep-failed')
    }
    if (this.ended) throw new PopupError('connection-closed')
    this.report('keep-acknowledged', performance.now() - startedAt)
  }

  /**
   * Closes a carrier the application may already hold, reporting departure
   * first: a closed carrier alone tells it nothing. Best-effort, and never a
   * reporting failure.
   */
  protected override discard(carrier: Carrier): void {
    try {
      carrier.send(DEPARTED)
    } catch {
      // No acknowledgement or retry can outlive this document reliably.
    }
    carrier.close()
  }

  /** Ends this endpoint, telling the application its document departed. */
  private depart(): void {
    if (this.carrier) this.discard(this.carrier)
    this.release()
  }

  private closePopup(): void {
    this.depart()
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
