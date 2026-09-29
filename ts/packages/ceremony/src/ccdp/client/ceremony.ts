import type { LedgerId } from '@libid/ledger'
import {
  type ConnectOptions,
  type Message,
  type MessageType,
  PopupConnection,
  PopupError,
  type PopupWindow,
} from '@libid/popup'
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
  CHAIN_ID_BYTES,
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
  MAX_TRANSACTION_DATA_BYTES,
  OPERATION_DOMAIN_BYTES,
} from '../../platforms/authorization.js'
import {
  assembleResult,
  commonVersions,
  type IdentityResult,
  implementationFor,
  type PlatformId,
  type SupportedCeremonyVersion,
  supportedPlatforms,
} from '../../platforms/index.js'
import { fixedBytes, hasExactKeys, origin } from '../../primitives.js'
import {
  CeremonyFailed,
  EventMessage,
  IdentityProof,
  type ProveIdentity,
  UserDenied,
  UUID,
} from '../index.js'
import { oauthState, prefetchFragment, route } from '../navigation.js'
import { messages } from '../ui-messages.js'
import { type CeremonyConfig, fetchCeremonyConfig } from './config.js'

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
interface Input<P extends PlatformId> {
  notaryAddress: string
  chainId: Uint8Array
  platformId: P
  version: SupportedCeremonyVersion<P>
  operationDomain: Uint8Array
  transactionData: Uint8Array
}

/** Application-scoped Bridge configuration used to construct independent ceremony runs. */
export interface CCDPClient {
  /**
   * Connect an application-owned popup, admitting only this Bridge and its configured CCDP.
   * Other popup options pass through; the caller retains the connection and owns closure.
   */
  connect<Out extends Message = Message, In extends Message = Out>(
    popup: PopupWindow,
    options: Omit<ConnectOptions, 'allowedPopupOrigins'>,
  ): PopupConnection<Out, In>
  /** Intersection of supported platforms and versions advertised by the Bridge. */
  readonly enabledPlatforms: readonly PlatformId[]
  /** Compatible versions in ascending order; returns an immutable list, empty for disabled platforms. */
  enabledVersions<P extends PlatformId>(platformId: P): readonly SupportedCeremonyVersion<P>[]
  /**
   * Snapshot ledger hash/address and input bytes before OAuth; invalid inputs throw synchronously.
   * Use the supplied connection's UUID as ceremonyId and one connection per live run.
   * Omitted version selects the highest compatible version, not a disclosure preference.
   */
  new: <P extends PlatformId>(
    conn: PopupConnection<Message>,
    ceremonyId: string,
    platformId: P,
    ledgerId: LedgerId,
    operationDomain: Uint8Array,
    transactionData: Uint8Array,
    ceremonyVersion?: SupportedCeremonyVersion<P>,
  ) => Ceremony<P>
}

/** Fetch and validate Bridge configuration once. Rejects unavailable or malformed configuration. */
export async function createCCDPClient(options: { oauthBridge: string }): Promise<CCDPClient> {
  if (!hasExactKeys(options, ['oauthBridge'])) throw new TypeError('Invalid client options')
  return ccdpClientFromConfig(await fetchCeremonyConfig(options.oauthBridge))
}

/** Internal construction from an already validated, frozen Bridge configuration. */
export function ccdpClientFromConfig(config: CeremonyConfig): CCDPClient {
  const popupOrigins = [...new Set([new URL(config.redirectUri).origin, config.ccdpOrigin])]
  const liveIds = new Set<string>()
  const enabledVersions = <P extends PlatformId>(platform: P) =>
    commonVersions(platform, config.platforms[platform]?.ceremonyVersions ?? [])
  const enabledPlatforms = Object.freeze(
    supportedPlatforms.filter((p) => enabledVersions(p).length > 0),
  )
  // Contextually typed by CCDPClient, whose declarations carry the documented signatures.
  const client: CCDPClient = {
    enabledPlatforms,
    enabledVersions,
    connect(popup, options) {
      return PopupConnection.connect(popup, { ...options, allowedPopupOrigins: popupOrigins })
    },
    new(conn, id, platformId, ledgerId, operationDomain, transactionData, ceremonyVersion) {
      if (typeof id !== 'string' || !UUID.test(id) || !enabledPlatforms.includes(platformId))
        throw new TypeError('Invalid ceremony selection')
      const version = selectVersion(enabledVersions(platformId), ceremonyVersion)
      const ledger = snapshotLedger(ledgerId)
      if (!fixedBytes(operationDomain, OPERATION_DOMAIN_BYTES))
        throw new TypeError('Operation domain must be 32 bytes')
      if (
        !(transactionData instanceof Uint8Array) ||
        transactionData.length > MAX_TRANSACTION_DATA_BYTES
      )
        throw new TypeError('Invalid transaction bytes')
      if (liveIds.has(id)) throw new TypeError('Ceremony ID is already live')
      const input = { ...ledger, platformId, version, operationDomain, transactionData }
      const run = new Run(id, conn, input, config, () => {
        liveIds.delete(id)
      })
      liveIds.add(id)
      return run
    },
  }
  return Object.freeze(client)
}

/** An omitted version selects the highest compatible one. */
function selectVersion<V>(available: readonly V[], requested: V | undefined): V {
  const version = requested === undefined ? available[available.length - 1] : requested
  if (!available.includes(version)) throw new TypeError('Unsupported ceremony version')
  return version
}

/** Read each ledger method once; later replacement of either method cannot affect the run. */
function snapshotLedger(ledgerId: LedgerId): { chainId: Uint8Array; notaryAddress: string } {
  if (!ledgerId || typeof ledgerId.hash !== 'function')
    throw new TypeError('Invalid ledger identity')
  const chainId = ledgerId.hash()
  if (!fixedBytes(chainId, CHAIN_ID_BYTES)) throw new TypeError('Ledger hash must be 32 bytes')
  if (typeof ledgerId.notaryAddress !== 'function') throw new TypeError('Missing notary address')
  const notaryAddress = ledgerId.notaryAddress()
  if (!origin(notaryAddress)) throw new TypeError('Invalid notary origin')
  return { chainId, notaryAddress }
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

class Run<P extends PlatformId> implements Ceremony<P> {
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
  private readonly start: ProveIdentity
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
    const implementation = implementationFor(this.platform, this.version)
    this.platformEvents = implementation.events
    const codeVerifier = implementation.pkce
      ? deriveCodeVerifier(digest, this.authorizationNonce)
      : null
    this.authorizationUrl = implementation.buildAuthorizationUrl({
      clientId: platform.clientId,
      redirectUri: config.redirectUri,
      state: oauthState(id),
      authorizationDigest: digest,
      codeChallenge: codeVerifier === null ? null : deriveCodeChallenge(codeVerifier),
    })
    this.start = {
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

  private publish(event: OperationEvent): void {
    this.events.emit({ ...event, status: 'active' })
  }

  private receiveEvent({ type: _type, ...event }: EventMessage): void {
    if (event.event === 'prefetch-dispatch') this.prefetched(event)
    else if (event.event === 'prover') this.proverReady(event)
    else {
      if (isCoreEvent(event.event)) this.observe(event.event, event.phase)
      this.publish(event)
    }
  }

  /** Prefetch readiness releases the one-shot authorization navigation. */
  private prefetched(event: OperationEvent): void {
    this.expect('prefetch')
    if (event.phase !== 'finished') throw sequenceError('Invalid prefetch readiness')
    this.state = 'oauth'
    const url = this.authorizationUrl
    this.authorizationUrl = ''
    this.publish(event)
    if (this.state !== 'oauth') return
    this.publish({ event: 'authorization', phase: 'started', timestamp: now() })
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
    this.connection.send({ ...this.start })
    this.publish(event)
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
          this.start.clientId,
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
      this.publish({ event: 'prefetch-dispatch', phase: 'started', timestamp: now() })
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
    this.start.codeVerifier = null
    this.authorizationUrl = ''
    this.authorizationNonce.fill(0)
    this.authorizationDigest.fill(0)
    this.result = undefined
    this.events.emit(event)
    if (outcome instanceof CeremonyError) result?.reject(outcome)
    else result?.resolve(outcome)
  }
}
