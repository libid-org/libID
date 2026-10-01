import { type Message, type PopupConnection, PopupError } from '@libid/popup'
import { route } from '../../assets/keys.js'
import { CeremonyError } from '../../errors.js'
import {
  type CeremonyEvent,
  type CoreEvent,
  EventFeed,
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
import { ccdpError } from '../failure.js'
import {
  CeremonyFailed,
  EventMessage,
  IdentityProof,
  type ProveIdentity,
  UserDenied,
} from '../index.js'
import { oauthState, prefetchFragment } from '../navigation.js'
import { messages } from '../uiMessages.js'
import type { CeremonyConfig } from './config.js'

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
interface CeremonyInput<P extends PlatformId> {
  notaryAddress: string
  chainId: Uint8Array
  platformId: P
  version: SupportedCeremonyVersion<P>
  operationDomain: Uint8Array
  transactionData: Uint8Array
}

/** Ordering violations only; other handler failures keep their own, possibly localized, text. */
const sequenceError = (reason: string) => new Error(`Invalid ceremony sequence: ${reason}`)

/** The CCDP messages a run receives. */
type Inbound = EventMessage | IdentityProof | UserDenied | CeremonyFailed

/** A channel's current run, as the channel sees it. */
interface Run {
  receive(message: Inbound): void
}

/**
 * One connection's CCDP message handlers, registered at its first run and routed to its current
 * run. Late traffic stays decodable, and dropped, without retaining a finished run's inputs.
 */
class CeremonyChannel {
  /** Connections belong to the application's popup package, so channels are found beside them. */
  static readonly #channels = new WeakMap<PopupConnection<Message>, CeremonyChannel>()
  #run: Run | null = null
  readonly #remove: (() => void)[] = []

  private constructor(private readonly connection: PopupConnection<Message>) {}

  /** Whether a run is attached to `connection`. */
  static active(connection: PopupConnection<Message>): boolean {
    const channel = CeremonyChannel.#channels.get(connection)
    return channel !== undefined && channel.#run !== null
  }

  /** The connection's channel; a registration failure leaves no handler and no channel. */
  static of(connection: PopupConnection<Message>): CeremonyChannel {
    const existing = CeremonyChannel.#channels.get(connection)
    if (existing) return existing
    const channel = new CeremonyChannel(connection)
    try {
      for (const type of [EventMessage, IdentityProof, UserDenied, CeremonyFailed])
        channel.#remove.push(
          connection.on(type, (message: Inbound) => channel.#run?.receive(message)),
        )
    } catch (error) {
      channel.#close()
      throw error
    }
    CeremonyChannel.#channels.set(connection, channel)
    void connection.closed.then(() => channel.#close())
    return channel
  }

  attach(run: Run): void {
    this.#run = run
  }

  detach(run: Run): void {
    if (this.#run === run) this.#run = null
  }

  #close(): void {
    for (const remove of this.#remove.splice(0)) remove()
    if (CeremonyChannel.#channels.get(this.connection) === this)
      CeremonyChannel.#channels.delete(this.connection)
  }
}

export class ClientCeremony<P extends PlatformId> implements Ceremony<P> {
  readonly launchUrl: string
  private state: 'new' | 'prefetch' | 'oauth' | 'proving' | 'done' = 'new'
  private readonly feed = new EventFeed()
  private readonly observations = new Set<string>()
  private proofWorkStarted = false
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
  private readonly ccdpOrigin: string
  private readonly fragment: URLSearchParams
  private result: PromiseWithResolvers<IdentityResult<P>> | undefined
  private channel: CeremonyChannel | undefined
  private startFailure: CeremonyError | undefined

  constructor(
    id: string,
    private readonly connection: PopupConnection<Message>,
    input: CeremonyInput<P>,
    config: CeremonyConfig,
    private readonly releaseId: () => void,
  ) {
    this.platform = input.platformId
    const platformConfig = config.platforms[this.platform]
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
      clientId: platformConfig.clientId,
      redirectUri: config.redirectUri,
      state: oauthState(id),
      authorizationDigest: digest,
      codeChallenge: codeVerifier === null ? null : deriveCodeChallenge(codeVerifier),
    })
    this.request = {
      type: 'prove-identity',
      platformId: this.platform,
      platformCeremonyVersion: this.version,
      clientId: platformConfig.clientId,
      redirectUri: config.redirectUri,
      codeVerifier,
      notaryAddress: input.notaryAddress,
      ...(platformConfig.clientCredential === undefined
        ? {}
        : { clientCredential: platformConfig.clientCredential }),
    }
    this.ccdpOrigin = config.ccdpOrigin
    this.prefetchUrl = config.ccdpOrigin + route('prefetch')
    this.fragment = prefetchFragment(id, this.platform, this.version)
    this.launchUrl = `${this.prefetchUrl}#${this.fragment}`
    Object.defineProperty(this, 'launchUrl', { writable: false })
    // Subscribed at creation: an ending before start still frees the ID and informs observers.
    void this.connection.closed.then((end) => {
      // A finished run ignores its connection ending; don't build an error nobody receives.
      if (this.state === 'done') return
      this.fail(
        end.outcome === 'failed'
          ? new PopupError(end.code)
          : new CeremonyError(this.interruptedEvent(), messages.connectionEnded, {
              status: 'closed',
            }),
      )
    })
  }

  onEvent(listener: (event: CeremonyEvent) => void): () => void {
    return this.state === 'done' ? () => {} : this.feed.onEvent(listener)
  }

  onStage(listener: (event: StageEvent) => void): () => void {
    return this.state === 'done' ? () => {} : this.feed.onStage(listener)
  }

  private emit(event: OperationEvent): void {
    this.feed.emit({ ...event, status: 'active' })
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
    this.expectCcdp()
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
        .catch((error) => this.fail(ccdpError(error, 'authorization')))
  }

  private proverReady(event: OperationEvent): void {
    this.expect('oauth')
    // The request carries the code verifier, which the Bridge's Callback must never hold.
    this.expectCcdp()
    if (event.phase !== 'started') throw sequenceError('Invalid prover readiness')
    this.state = 'proving'
    // Readiness processing precedes observers; no subscription is needed to start proving.
    this.connection.send({ ...this.request })
    this.emit(event)
  }

  /** Readiness and results count only from a CCDP document; the Bridge is also an admitted popup origin. */
  private expectCcdp(): void {
    if (this.connection.peerOrigin !== this.ccdpOrigin)
      throw sequenceError('Message from outside the CCDP')
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

  /** One CCDP message for this run; a failure in handling it fails the run. */
  receive(message: Inbound): void {
    if (this.state === 'done') return
    try {
      if (message.type === 'event') this.receiveEvent(message)
      else if (message.type === 'identity-proof') this.receiveProof(message)
      else if (message.type === 'user-denied') this.receiveDenial()
      else this.fail(new CeremonyError(message.event, message.message))
    } catch (error) {
      this.fail(error)
    }
  }

  private receiveProof(message: IdentityProof): void {
    this.expect('proving')
    this.expectCcdp()
    const result = assembleResult(
      this.platform,
      this.version,
      message,
      this.request.clientId,
      this.authorizationNonce,
      this.authorizationDigest,
    )
    this.finish(
      { event: 'prover', phase: 'finished', status: 'completed', timestamp: now() },
      result,
    )
  }

  private receiveDenial(): void {
    this.expect('proving')
    this.expectCcdp()
    if (this.proofWorkStarted) throw sequenceError('Denial after proof work began')
    this.finish({ status: 'denied', timestamp: now() }, { status: 'denied' })
  }

  private expect(state: typeof this.state): void {
    if (this.state !== state) throw sequenceError('Unexpected ceremony message')
  }

  proveUserIdentity(): Promise<IdentityResult<P>> {
    if (this.state === 'new' && CeremonyChannel.active(this.connection))
      this.fail(new CeremonyError('prefetch-dispatch', 'Connection already has an active ceremony'))
    if (this.startFailure) {
      const failure = this.startFailure
      this.startFailure = undefined
      return Promise.reject(failure)
    }
    if (this.state !== 'new') return Promise.reject(new Error('Ceremony is one-shot'))
    this.state = 'prefetch'
    const result = Promise.withResolvers<IdentityResult<P>>()
    this.result = result
    try {
      this.channel = CeremonyChannel.of(this.connection)
    } catch {
      this.fail(new Error(messages.connectionInitializationFailed))
      return result.promise
    }
    this.channel.attach(this)
    this.emit({ event: 'prefetch-dispatch', phase: 'started', timestamp: now() })
    if (this.state === 'prefetch')
      void this.connection
        .navigate(this.prefetchUrl, this.fragment)
        .catch((error) => this.fail(ccdpError(error, 'prefetch-dispatch')))
    return result.promise
  }

  /** The operation a failure interrupts. */
  private interruptedEvent(): string {
    if (this.state === 'new' || this.state === 'prefetch') return 'prefetch-dispatch'
    // Once the return reached Callback, the Prover is what is still pending.
    const returned =
      this.observations.has('authorization/finished') || this.observations.has('prover-fallback/')
    return this.state === 'oauth' && !returned ? 'authorization' : 'prover'
  }

  private fail(error: unknown): void {
    if (this.state === 'done') return
    const failure = ccdpError(error, this.interruptedEvent())
    if (this.state === 'new') this.startFailure = failure
    this.finish(failureEvent(failure), failure)
  }

  /** Release the run before its one terminal update, then settle with the captured resolvers. */
  private finish(
    event: Exclude<CeremonyEvent, { status: 'active' }>,
    outcome: IdentityResult<P> | CeremonyError,
  ): void {
    const result = this.result
    this.channel?.detach(this)
    this.state = 'done'
    this.releaseId()
    this.observations.clear()
    this.request.codeVerifier = null
    this.authorizationUrl = ''
    this.authorizationNonce.fill(0)
    this.authorizationDigest.fill(0)
    this.result = undefined
    this.feed.emit(event)
    if (outcome instanceof CeremonyError) result?.reject(outcome)
    else result?.resolve(outcome)
  }
}
