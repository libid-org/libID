import type { LedgerId } from '@libid/ledger'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import { CeremonyError, ceremonyError } from '../../errors.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
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
import { hasExactKeys, isRecord, origin } from '../../primitives.js'
import {
  Abort,
  Cancel,
  Event as EventMessage,
  IdentityProof,
  type ProveIdentity,
  UUID,
} from '../index.js'
import { oauthState, prefetchFragment, route } from '../navigation.js'
import { type CeremonyConfig, fetchCeremonyConfig } from './config.js'

export type { CeremonyEvent, CeremonyStage, StageEvent } from '../../events.js'

import {
  type CeremonyEvent,
  type CoreEvent,
  coreEvents,
  Events,
  now,
  type OperationEvent,
  type StageEvent,
} from '../../events.js'

/** One ceremony over a caller-supplied connection; the application owns the window. */
export interface Ceremony<P extends PlatformId = PlatformId> {
  /** Initial CCDP Prefetch URL, including the private ceremony navigation fragment. */
  readonly launchUrl: string
  /** Subscribe to advisory events. Returns an unsubscribe function; listener exceptions do not fail the run. */
  onEvent(listener: (event: CeremonyEvent) => void): () => void
  /** Subscribe to the sequential UI projection, including terminal status and error text. */
  onStage(listener: (event: StageEvent) => void): () => void
  /** Start once; resolve accepted/denied output, or reject cancellation and technical failures. */
  proveUserIdentity(): Promise<IdentityResult<P>>
  /** Cancel this run. Calling again after termination has no effect. */
  cancel(): Promise<void>
}

interface Input<P extends PlatformId> {
  connection: PopupConnection<Message>
  notaryAddress: string | null
  chainId: Uint8Array
  platformId: P
  version: SupportedCeremonyVersion<P>
  operationDomain: Uint8Array
  transactionData: Uint8Array
}

/** Application-scoped Bridge configuration used to construct independent ceremony runs. */
export interface CCDPClient {
  /** Intersection of supported platforms and versions advertised by the Bridge. */
  readonly enabledPlatforms: readonly PlatformId[]
  /** Compatible versions in ascending order; returns an immutable list, empty for disabled platforms. */
  enabledVersions<P extends PlatformId>(platformId: P): readonly SupportedCeremonyVersion<P>[]
  /** Snapshot inputs before OAuth. Omitted version selects the highest compatible version. */
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
  if (!isRecord(options) || !hasExactKeys(options, ['oauthBridge']))
    throw new TypeError('Invalid client options')
  return ccdpClientFromConfig(await fetchCeremonyConfig(options.oauthBridge))
}

/** Internal construction from an already validated, frozen Bridge configuration. */
export function ccdpClientFromConfig(config: CeremonyConfig): CCDPClient {
  const liveIds = new Set<string>()
  const enabledVersions = <P extends PlatformId>(platform: P) =>
    commonVersions(platform, config.platforms[platform]?.ceremonyVersions ?? [])
  const enabledPlatforms = Object.freeze(
    supportedPlatforms.filter((p) => enabledVersions(p).length > 0),
  )
  return Object.freeze({
    enabledPlatforms,
    enabledVersions,
    new<P extends PlatformId>(
      conn: PopupConnection<Message>,
      id: string,
      platformId: P,
      ledgerId: LedgerId,
      operationDomain: Uint8Array,
      transactionData: Uint8Array,
      ceremonyVersion?: SupportedCeremonyVersion<P>,
    ): Ceremony<P> {
      if (typeof id !== 'string' || !UUID.test(id) || !enabledPlatforms.includes(platformId))
        throw new TypeError('Invalid ceremony selection')
      const available = enabledVersions(platformId)
      const version =
        ceremonyVersion === undefined ? available[available.length - 1] : ceremonyVersion
      if (!available.includes(version)) throw new TypeError('Unsupported ceremony version')
      if (!ledgerId || typeof ledgerId.hash !== 'function')
        throw new TypeError('Invalid ledger identity')
      const hash = ledgerId.hash()
      if (!(hash instanceof Uint8Array) || hash.length !== 32)
        throw new TypeError('Ledger hash must be 32 bytes')
      const chainId = Uint8Array.from(hash)
      let notaryAddress: string | null = null
      if (platformId !== 'google') {
        if (typeof ledgerId.notaryAddress !== 'function')
          throw new TypeError('Missing notary address')
        notaryAddress = ledgerId.notaryAddress()
        if (!origin(notaryAddress)) throw new TypeError('Invalid notary origin')
      }
      if (!(operationDomain instanceof Uint8Array) || operationDomain.length !== 32)
        throw new TypeError('Operation domain must be 32 bytes')
      if (!(transactionData instanceof Uint8Array) || transactionData.length > 0xffffffff)
        throw new TypeError('Invalid transaction bytes')
      if (liveIds.has(id)) throw new TypeError('Ceremony ID is already live')
      const run = new Run(
        id,
        {
          connection: conn,
          platformId,
          version,
          operationDomain,
          transactionData,
          chainId,
          notaryAddress,
        },
        config,
        () => {
          liveIds.delete(id)
        },
      )
      liveIds.add(id)
      return run
    },
  })
}

type Binding = { active: boolean; remove: (() => void)[] }

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
  private readonly connection: PopupConnection<Message>
  private readonly platform: P
  private readonly version: SupportedCeremonyVersion<P>
  private readonly retained: {
    operationDomain: Uint8Array
    authorizationNonce: Uint8Array
    transactionData: Uint8Array
  }
  private readonly start: ProveIdentity
  private authorizationUrl: string
  private readonly prefetchUrl: string
  private readonly fragment: URLSearchParams
  private resolve: ((value: IdentityResult<P>) => void) | undefined
  private reject: ((reason: Error) => void) | undefined
  private binding: Binding | undefined

  constructor(
    id: string,
    input: Input<P>,
    config: CeremonyConfig,
    private readonly releaseId: () => void,
  ) {
    this.connection = input.connection
    this.platform = input.platformId
    const platform = config.platforms[this.platform]
    this.version = input.version
    this.retained = {
      operationDomain: Uint8Array.from(input.operationDomain),
      authorizationNonce: crypto.getRandomValues(new Uint8Array(32)),
      transactionData: Uint8Array.from(input.transactionData),
    }
    const digest = deriveAuthorizationDigest({
      ...this.retained,
      chainId: input.chainId,
      platformCeremonyVersion: this.version,
    })
    const implementation = implementationFor(this.platform, this.version)
    const codeVerifier = implementation.pkce
      ? deriveCodeVerifier(digest, this.retained.authorizationNonce)
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
    }
    this.prefetchUrl = config.ccdpOrigin + route('prefetch')
    this.fragment = prefetchFragment(id, this.platform, this.version)
    this.launchUrl = `${this.prefetchUrl}#${this.fragment}`
    Object.defineProperty(this, 'launchUrl', { writable: false })
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

  private finish(event: Exclude<CeremonyEvent, { status: 'active' }>): void {
    this.cleanup()
    this.events.emit(event)
  }

  private receiveEvent(message: EventMessage): void {
    const { type: _type, ...event } = message
    const core = coreEvents.includes(event.event as CoreEvent)
    if (event.event === 'prefetch-dispatch') {
      this.expect('prefetch')
      if (event.phase !== 'finished') throw new Error('Invalid prefetch readiness')
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
      return
    }
    if (event.event === 'prover') {
      this.expect('oauth')
      if (event.phase !== 'started') throw new Error('Invalid prover readiness')
      this.state = 'proving'
      // Readiness processing precedes observers; no subscription is needed to start proving.
      this.connection.send({ ...this.start })
      this.publish(event)
      return
    }
    if (event.event === 'authorization' || event.event === 'prover-fallback') {
      this.expect('oauth')
      if (event.event === 'authorization' && event.phase !== 'finished')
        throw new Error('Invalid authorization observation')
    } else if (core) {
      this.expect('proving')
      if (
        (this.platform === 'google' && !event.event.startsWith('zk-')) ||
        (this.platform === 'github' && event.event === 'token-fetch')
      )
        throw new Error('Event does not apply to platform')
      this.proofWorkStarted = true
    }
    if (core) {
      const key = `${event.event}/${event.phase ?? ''}`
      if (this.observations.has(key)) throw new Error('Duplicate core occurrence')
      if (
        event.phase === 'finished' &&
        event.event !== 'authorization' &&
        !this.observations.has(`${event.event}/started`)
      )
        throw new Error('Core finish precedes start')
      this.observations.add(key)
    }
    this.publish(event)
  }

  private listen<M extends Message>(type: MessageType<M>, handler: (message: M) => void): void {
    const listener = receiver((m: M) => {
      if (this.state === 'done') return
      try {
        handler(m)
      } catch (error) {
        this.fail(
          new Error(
            `Invalid ceremony sequence: ${error instanceof Error ? error.message : 'unexpected message'}`,
          ),
        )
      }
    })
    this.binding!.remove.push(this.connection.on(type, listener.receive))
    this.off.push(listener.clear)
  }

  private expect(state: typeof this.state): void {
    if (this.state !== state) throw new Error('Unexpected ceremony message')
  }

  proveUserIdentity(): Promise<IdentityResult<P>> {
    if (this.state !== 'new') return Promise.reject(new Error('Ceremony is one-shot'))
    const previous = bindings.get(this.connection)
    if (previous?.active) {
      const error = new CeremonyError(
        'prefetch-dispatch',
        'Connection already has an active ceremony',
      )
      this.fail(error)
      return Promise.reject(error)
    }
    for (const remove of previous?.remove ?? []) remove()
    const binding = { active: true, remove: [] as (() => void)[] }
    bindings.set(this.connection, binding)
    this.binding = binding
    void this.connection.closed.then(() => {
      for (const remove of binding.remove) remove()
      if (bindings.get(this.connection) === binding) bindings.delete(this.connection)
    })
    this.state = 'prefetch'
    const result = new Promise<IdentityResult<P>>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    try {
      this.listen(EventMessage, (event) => this.receiveEvent(event))
      this.listen(IdentityProof, (m) => {
        this.expect('proving')
        const result = assembleResult(
          this.platform,
          this.version,
          m,
          this.start.clientId,
          this.retained.authorizationNonce,
        )
        const resolve = this.resolve
        this.finish({
          event: 'prover',
          phase: 'finished',
          status: 'completed',
          timestamp: now(),
        })
        resolve?.(result)
      })
      this.listen(Cancel, () => {
        this.expect('proving')
        if (this.proofWorkStarted) throw new Error('Denial after proof work began')
        const resolve = this.resolve
        this.finish({
          status: 'denied',
          timestamp: now(),
        })
        resolve?.({ status: 'denied' })
      })
      this.listen(Abort, (message) => this.fail(new CeremonyError(message.event, message.message)))
      void this.connection.ready.catch(() => this.fail(new Error('Popup connection failed')))
      void this.connection.closed.then(() => this.fail(new Error('Popup connection ended')))
      this.publish({ event: 'prefetch-dispatch', phase: 'started', timestamp: now() })
      if (this.state === 'prefetch')
        void this.connection
          .navigate(this.prefetchUrl, this.fragment)
          .catch(() => this.fail(new Error('Prefetch navigation failed')))
    } catch {
      for (const remove of binding.remove.splice(0)) remove()
      if (bindings.get(this.connection) === binding) bindings.delete(this.connection)
      this.fail(new Error('Unable to initialize ceremony connection'))
    }
    return result
  }

  async cancel(): Promise<void> {
    if (this.state === 'done') return
    const active = this.state === 'oauth' || this.state === 'proving'
    this.fail(new DOMException('Ceremony canceled', 'AbortError'))
    if (active && bindings.get(this.connection) === this.binding && !this.binding?.active)
      try {
        this.connection.send({ type: 'cancel' })
      } catch {
        /* Best effort; local cancellation already won. */
      }
  }

  private fail(error: Error): void {
    if (this.state === 'done') return
    const reject = this.reject
    const failure = ceremonyError(
      error,
      this.state === 'prefetch' || this.state === 'new'
        ? 'prefetch-dispatch'
        : this.state === 'oauth'
          ? 'authorization'
          : 'prover',
    )
    this.finish(
      error.name === 'AbortError'
        ? { status: 'cancelled', timestamp: now() }
        : { status: 'failed', event: failure.event, message: failure.message, timestamp: now() },
    )
    reject?.(error.name === 'AbortError' ? error : failure)
  }

  private cleanup(): void {
    if (this.binding) this.binding.active = false
    this.state = 'done'
    this.releaseId()
    for (const off of this.off.splice(0)) off()
    this.observations.clear()
    this.start.codeVerifier = null
    this.authorizationUrl = ''
    this.retained.authorizationNonce.fill(0)
    this.retained.operationDomain.fill(0)
    this.retained.transactionData.fill(0)
    this.resolve = undefined
    this.reject = undefined
  }
}
