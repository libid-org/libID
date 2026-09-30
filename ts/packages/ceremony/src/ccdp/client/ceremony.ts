import { type Message, type MessageType, PopupConnection, PopupError } from '@libid/popup'
import { CeremonyError, ceremonyError } from '../../errors.js'
import {
  type CeremonyEvent,
  type CoreEvent,
  Events,
  failureEvent,
  isCoreEvent,
  now,
  type OperationEvent,
  type StageEvent,
} from '../../events.js'
import {
  AUTHORIZATION_NONCE_BYTES,
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../../platforms/authorization.js'
import {
  assembleResult,
  ceremonyFor,
  type IdentityResult,
  type PlatformId,
  type SupportedCeremonyVersion,
} from '../../platforms/index.js'
import {
  CeremonyFailed,
  EventMessage,
  IdentityProof,
  type ProveIdentity,
  UserDenied,
} from '../index.js'
import { oauthState, prefetchFragment, route } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { type CeremonyConfig } from './config.js'

/** One ceremony over a caller-supplied connection; the application owns the window. */
export interface Ceremony<P extends PlatformId = PlatformId> {
  /** Initial CCDP Prefetch URL, including the private ceremony navigation fragment. */
  readonly launchUrl: string
  /** Subscribe to advisory events. Returns an unsubscribe function; listener exceptions do not fail the run. */
  onEvent(listener: (event: CeremonyEvent) => void): () => void
  /** Subscribe to the sequential UI projection, including terminal status and error text. */
  onStage(listener: (event: StageEvent) => void): () => void
  /** Start once; resolve accepted/denied output, or reject connection loss and technical failures. */
  proveUserIdentity(): Promise<IdentityResult<P>>
}

/** Validated `new` arguments; byte inputs are read only while deriving the digest. */
export interface Input<P extends PlatformId> {
  notaryAddress: string
  chainId: Uint8Array
  platformId: P
  version: SupportedCeremonyVersion<P>
  operationDomain: Uint8Array
  transactionData: Uint8Array
}

type Binding = { active: boolean; remove: (() => void)[] }

/** Ordering violations only; other handler failures keep their own, possibly localized, text. */
const sequenceError = (reason: string) => new Error(`Invalid ceremony sequence: ${reason}`)

const bindings = new WeakMap<PopupConnection<Message>, Binding>()

// Keep decoding late CCDP traffic without retaining the completed run's inputs.
function receiver<M extends Message>(handler: ((message: M) => void) | undefined) {
  return {
    receive(message: M) {
      handler?.(message)
    },
    clear() {
      handler = undefined
    },
  }
}

export class ClientCeremony<P extends PlatformId> implements Ceremony<P> {
  readonly launchUrl: string
  private state: 'new' | 'prefetch' | 'oauth' | 'proving' | 'done' = 'new'
  private readonly events = new Events()
  private readonly observations = new Set<string>()
  private proofWorkStarted = false
  private readonly off: (() => void)[] = []
  private readonly platform: P
  private readonly version: SupportedCeremonyVersion<P>
  private readonly platformEvents: readonly CoreEvent[]
  private readonly authorizationNonce = crypto.getRandomValues(
    new Uint8Array(AUTHORIZATION_NONCE_BYTES),
  )
  private readonly authorizationDigest: Uint8Array
  private readonly request: ProveIdentity
  private authorizationUrl: string
  private readonly prefetchUrl: string
  private readonly fragment: URLSearchParams
  private result: PromiseWithResolvers<IdentityResult<P>> | undefined
  private binding: Binding | undefined
  private startFailure: CeremonyError | undefined

  constructor(
    id: string,
    private readonly connection: PopupConnection<Message>,
    input: Input<P>,
    config: CeremonyConfig,
    private readonly releaseId: () => void,
  ) {
    this.platform = input.platformId
    const platform = config.platforms[this.platform]
    this.version = input.version
    // Deriving here, before `new` returns, makes later caller mutation irrelevant.
    const digest = deriveAuthorizationDigest({
      operationDomain: input.operationDomain,
      transactionData: input.transactionData,
      chainId: input.chainId,
      authorizationNonce: this.authorizationNonce,
      platformCeremonyVersion: this.version,
    })
    this.authorizationDigest = digest
    const platformCeremony = ceremonyFor(this.platform, this.version)
    this.platformEvents = platformCeremony.events
    const codeVerifier = platformCeremony.pkce
      ? deriveCodeVerifier(digest, this.authorizationNonce)
      : null
    this.authorizationUrl = platformCeremony.buildAuthorizationUrl({
      clientId: platform.clientId,
      redirectUri: config.redirectUri,
      state: oauthState(id),
      authorizationDigest: digest,
      codeChallenge: codeVerifier === null ? null : deriveCodeChallenge(codeVerifier),
    })
    this.request = {
      type: 'prove-identity',
      platformId: this.platform,
      platformCeremonyVersion: this.version,
      clientId: platform.clientId,
      redirectUri: config.redirectUri,
      codeVerifier,
      notaryAddress: input.notaryAddress,
      ...(platform.clientCredential === undefined
        ? {}
        : { clientCredential: platform.clientCredential }),
    }
    this.prefetchUrl = config.ccdpOrigin + route('prefetch')
    this.fragment = prefetchFragment(id, this.platform, this.version)
    this.launchUrl = `${this.prefetchUrl}#${this.fragment}`
    Object.defineProperty(this, 'launchUrl', { writable: false })
    void this.connection.closed.then((end) => {
      // A finished run ignores its connection ending; don't build an error nobody receives.
      if (this.state === 'done') return
      this.fail(
        end.outcome === 'failed'
          ? new PopupError(end.code)
          : new CeremonyError(this.operation(), messages.connectionEnded, { status: 'closed' }),
      )
    })
  }

  onEvent(listener: (event: CeremonyEvent) => void): () => void {
    return this.state === 'done' ? () => {} : this.events.onEvent(listener)
  }

  onStage(listener: (event: StageEvent) => void): () => void {
    return this.state === 'done' ? () => {} : this.events.onStage(listener)
  }

  private emit(event: OperationEvent): void {
    this.events.emit({ ...event, status: 'active' })
  }

  private receiveEvent({ type: _type, ...event }: EventMessage): void {
    if (event.event === 'prefetch-dispatch') this.prefetched(event)
    else if (event.event === 'prover') this.proverReady(event)
    else {
      if (isCoreEvent(event.event)) this.observe(event.event, event.phase)
      this.emit(event)
    }
  }

  /** Prefetch readiness releases the one-shot authorization navigation. */
  private prefetched(event: OperationEvent): void {
    this.expect('prefetch')
    if (event.phase !== 'finished') throw sequenceError('Invalid prefetch readiness')
    this.state = 'oauth'
    const url = this.authorizationUrl
    this.authorizationUrl = ''
    this.emit(event)
    if (this.state !== 'oauth') return
    this.emit({ event: 'authorization', phase: 'started', timestamp: now() })
    if (this.state === 'oauth')
      void this.connection
        .navigateAway(url)
        .catch((error) => this.fail(ceremonyError(error, 'authorization')))
  }

  private proverReady(event: OperationEvent): void {
    this.expect('oauth')
    if (event.phase !== 'started') throw sequenceError('Invalid prover readiness')
    this.state = 'proving'
    // Readiness processing precedes observers; no subscription is needed to start proving.
    this.connection.send({ ...this.request })
    this.emit(event)
  }

  /** Core observations must fit the run's state and platform, once each, started before finished. */
  private observe(event: CoreEvent, phase: OperationEvent['phase']): void {
    if (event === 'authorization' || event === 'prover-fallback') {
      this.expect('oauth')
      if (event === 'authorization' && phase !== 'finished')
        throw sequenceError('Invalid authorization observation')
    } else {
      this.expect('proving')
      if (!this.platformEvents.includes(event))
        throw sequenceError('Event does not apply to platform')
      this.proofWorkStarted = true
    }
    const key = `${event}/${phase ?? ''}`
    if (this.observations.has(key)) throw sequenceError('Duplicate core occurrence')
    if (
      phase === 'finished' &&
      event !== 'authorization' &&
      !this.observations.has(`${event}/started`)
    )
      throw sequenceError('Core finish precedes start')
    this.observations.add(key)
  }

  private listen<M extends Message>(
    binding: Binding,
    type: MessageType<M>,
    handler: (message: M) => void,
  ): void {
    const listener = receiver((m: M) => {
      if (this.state === 'done') return
      try {
        handler(m)
      } catch (error) {
        this.fail(error)
      }
    })
    binding.remove.push(this.connection.on(type, listener.receive))
    this.off.push(listener.clear)
  }

  private expect(state: typeof this.state): void {
    if (this.state !== state) throw sequenceError('Unexpected ceremony message')
  }

  proveUserIdentity(): Promise<IdentityResult<P>> {
    const previous = bindings.get(this.connection)
    if (this.state === 'new' && previous?.active)
      this.fail(new CeremonyError('prefetch-dispatch', 'Connection already has an active ceremony'))
    if (this.startFailure) {
      const failure = this.startFailure
      this.startFailure = undefined
      return Promise.reject(failure)
    }
    if (this.state !== 'new') return Promise.reject(new Error('Ceremony is one-shot'))
    for (const remove of previous?.remove ?? []) remove()
    const binding = { active: true, remove: [] as (() => void)[] }
    bindings.set(this.connection, binding)
    this.binding = binding
    void this.connection.closed.then(() => {
      for (const remove of binding.remove) remove()
      if (bindings.get(this.connection) === binding) bindings.delete(this.connection)
    })
    this.state = 'prefetch'
    const result = Promise.withResolvers<IdentityResult<P>>()
    this.result = result
    try {
      this.listen(binding, EventMessage, (event) => this.receiveEvent(event))
      this.listen(binding, IdentityProof, (m) => {
        this.expect('proving')
        const result = assembleResult(
          this.platform,
          this.version,
          m,
          this.request.clientId,
          this.authorizationNonce,
          this.authorizationDigest,
        )
        this.finish(
          { event: 'prover', phase: 'finished', status: 'completed', timestamp: now() },
          result,
        )
      })
      this.listen(binding, UserDenied, () => {
        this.expect('proving')
        if (this.proofWorkStarted) throw sequenceError('Denial after proof work began')
        this.finish({ status: 'denied', timestamp: now() }, { status: 'denied' })
      })
      this.listen(binding, CeremonyFailed, (message) =>
        this.fail(new CeremonyError(message.event, message.message)),
      )
      this.emit({ event: 'prefetch-dispatch', phase: 'started', timestamp: now() })
      if (this.state === 'prefetch')
        void this.connection
          .navigate(this.prefetchUrl, this.fragment)
          .catch((error) => this.fail(ceremonyError(error, 'prefetch-dispatch')))
    } catch {
      for (const remove of binding.remove.splice(0)) remove()
      if (bindings.get(this.connection) === binding) bindings.delete(this.connection)
      this.fail(new Error(messages.connectionInitializationFailed))
    }
    return result.promise
  }

  /** The operation a failure interrupts. */
  private operation(): string {
    if (this.state === 'new' || this.state === 'prefetch') return 'prefetch-dispatch'
    return this.state === 'oauth' ? 'authorization' : 'prover'
  }

  private fail(error: unknown): void {
    if (this.state === 'done') return
    const failure = ceremonyError(error, this.operation())
    if (this.state === 'new') this.startFailure = failure
    this.finish(failureEvent(failure), failure)
  }

  /** Release the run before its one terminal update, then settle with the captured resolvers. */
  private finish(
    event: Exclude<CeremonyEvent, { status: 'active' }>,
    outcome: IdentityResult<P> | CeremonyError,
  ): void {
    const result = this.result
    if (this.binding) this.binding.active = false
    this.state = 'done'
    this.releaseId()
    for (const off of this.off.splice(0)) off()
    this.observations.clear()
    this.request.codeVerifier = null
    this.authorizationUrl = ''
    this.authorizationNonce.fill(0)
    this.authorizationDigest.fill(0)
    this.result = undefined
    this.events.emit(event)
    if (outcome instanceof CeremonyError) result?.reject(outcome)
    else result?.resolve(outcome)
  }
}
