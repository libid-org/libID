import type { LedgerId } from '@libid/ledger'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import { CeremonyError } from '../../errors.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../../platforms/authorization.js'
import {
  assembleResult,
  greatestCommonVersion,
  type IdentityResult,
  implementationFor,
  type PlatformId,
  platforms,
  supportedPlatforms,
} from '../../platforms/index.js'
import { hasExactKeys, isRecord } from '../../primitives.js'
import {
  AbortCeremony,
  type AppStartProver,
  CallbackReady,
  CancelCeremony,
  origin,
  PrefetchReady,
  PrefetchStarted,
  ProverIdentityProof,
  ProverNotifyEvent,
  ProverReady,
  UUID,
} from '../index.js'
import { oauthState, prefetchFragment, route } from '../navigation.js'
import { type CeremonyConfig, fetchCeremonyConfig } from './config.js'

export type { CeremonyEvent, CeremonyStage } from '../../events.js'

import { type CeremonyEvent, type CeremonyStage, stages } from '../../events.js'

/** One ceremony over a caller-supplied connection; the application owns the window. */
export interface Ceremony<P extends PlatformId = PlatformId> {
  /** Initial CCDP Prefetch URL, including the private ceremony navigation fragment. */
  readonly launchUrl: string
  /** Subscribe to advisory events. Returns an unsubscribe function; listener exceptions do not fail the run. */
  onEvent(listener: (event: CeremonyEvent) => void): () => void
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
  operationDomain: Uint8Array
  transactionData: Uint8Array
}

/** Application-scoped Bridge configuration used to construct independent ceremony runs. */
export interface CCDPClient {
  /** Intersection of supported platforms and versions advertised by the Bridge. */
  readonly enabledPlatforms: readonly PlatformId[]
  /** Snapshot ledger/operation inputs and reserve the ID; no OAuth navigation occurs yet. */
  new: <P extends PlatformId>(
    conn: PopupConnection<Message>,
    ceremonyId: string,
    ledgerId: LedgerId,
    platformId: P,
    operationDomain: Uint8Array,
    transactionData: Uint8Array,
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
  const enabledPlatforms = Object.freeze(
    supportedPlatforms.filter((p) =>
      config.platforms[p]?.ceremonyVersions.some((v) => Object.hasOwn(platforms[p].versions, v)),
    ),
  )
  return Object.freeze({
    enabledPlatforms,
    new<P extends PlatformId>(
      conn: PopupConnection<Message>,
      id: string,
      ledgerId: LedgerId,
      platformId: P,
      operationDomain: Uint8Array,
      transactionData: Uint8Array,
    ): Ceremony<P> {
      if (typeof id !== 'string' || !UUID.test(id) || !enabledPlatforms.includes(platformId))
        throw new TypeError('Invalid ceremony selection')
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
  private stage: CeremonyStage = 'start'
  private readonly listeners = new Set<(event: CeremonyEvent) => void>()
  private readonly off: (() => void)[] = []
  private readonly connection: PopupConnection<Message>
  private readonly platform: P
  private readonly version: ReturnType<typeof greatestCommonVersion<P>>
  private readonly retained: {
    operationDomain: Uint8Array
    authorizationNonce: Uint8Array
    transactionData: Uint8Array
  }
  private readonly start: AppStartProver
  private authorizationUrl: string
  private readonly prefetchUrl: string
  private readonly fragment: URLSearchParams
  private resolve: ((value: IdentityResult<P>) => void) | undefined
  private reject: ((reason: Error) => void) | undefined
  private progress = 0
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
    this.version = greatestCommonVersion(this.platform, platform.ceremonyVersions)
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
      type: 'app-start-prover',
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
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: CeremonyEvent, listeners = [...this.listeners]): void {
    for (const listener of listeners) {
      if (this.state === 'done' && event.type !== 'finished') return
      try {
        listener(
          event.type === 'step'
            ? { ...event, platformStep: { ...event.platformStep } }
            : { ...event },
        )
      } catch {
        /* Observers cannot affect ceremony authority. */
      }
    }
  }

  private enterStage(stage: CeremonyStage): void {
    if (this.state === 'done' || stages.indexOf(stage) <= stages.indexOf(this.stage)) return
    if (this.platform === 'google' && ['code-exchange', 'identity-fetch'].includes(stage)) return
    this.stage = stage
    this.emit({ type: 'stage', stage, timestamp: performance.timeOrigin + performance.now() })
  }

  private finish(event: CeremonyEvent & { type: 'finished' }): void {
    const listeners = [...this.listeners]
    this.cleanup()
    this.emit(event, listeners)
  }

  private listen<M extends Message>(type: MessageType<M>, handler: (message: M) => void): void {
    const listener = receiver((m: M) => {
      if (this.state === 'done') return
      try {
        handler(m)
      } catch {
        this.fail(new Error('Invalid ceremony sequence'))
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
      const error = new Error('Connection already has an active ceremony')
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
      this.listen(PrefetchReady, () => {
        if (this.state === 'prefetch') this.enterStage('prefetch')
      })
      this.listen(CallbackReady, () => {
        if (this.state === 'oauth') this.enterStage('oauth-return')
      })
      this.listen(PrefetchStarted, () => {
        this.expect('prefetch')
        this.state = 'oauth'
        const url = this.authorizationUrl
        this.authorizationUrl = ''
        this.enterStage('authorization')
        if (this.state !== 'oauth') return
        void this.connection
          .navigateAway(url)
          .catch(() => this.fail(new Error('OAuth navigation failed')))
      })
      this.listen(ProverReady, () => {
        this.expect('oauth')
        this.state = 'proving'
        this.connection.send({ ...this.start })
      })
      this.listen(ProverNotifyEvent, (m) => {
        this.expect('proving')
        if ('stage' in m) {
          this.enterStage(m.stage)
          return
        }
        if (m.platformStep.progress < this.progress) return
        this.progress = m.platformStep.progress
        this.emit({ type: 'step', platformStep: m.platformStep, timestamp: m.timestamp })
      })
      this.listen(ProverIdentityProof, (m) => {
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
          type: 'finished',
          outcome: 'success',
          timestamp: performance.timeOrigin + performance.now(),
        })
        resolve?.(result)
      })
      this.listen(CancelCeremony, () => {
        this.expect('proving')
        const resolve = this.resolve
        this.finish({
          type: 'finished',
          outcome: 'denied',
          timestamp: performance.timeOrigin + performance.now(),
        })
        resolve?.({ status: 'denied' })
      })
      this.listen(AbortCeremony, (message) => this.fail(new CeremonyError(message.code)))
      void this.connection.ready.catch(() => this.fail(new Error('Popup connection failed')))
      void this.connection.closed.then(() => this.fail(new Error('Popup connection ended')))
      this.emit({
        type: 'stage',
        stage: 'start',
        timestamp: performance.timeOrigin + performance.now(),
      })
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
        this.connection.send({ type: 'cancel-ceremony' })
      } catch {
        /* Best effort; local cancellation already won. */
      }
  }

  private fail(error: Error): void {
    if (this.state === 'done') return
    const reject = this.reject
    const timestamp = performance.timeOrigin + performance.now()
    this.finish(
      error.name === 'AbortError'
        ? { type: 'finished', outcome: 'cancelled', timestamp }
        : {
            type: 'finished',
            outcome: 'failed',
            code: error instanceof CeremonyError ? error.code : null,
            timestamp,
          },
    )
    reject?.(error)
  }

  private cleanup(): void {
    if (this.binding) this.binding.active = false
    this.state = 'done'
    this.releaseId()
    for (const off of this.off.splice(0)) off()
    this.listeners.clear()
    this.start.codeVerifier = null
    this.authorizationUrl = ''
    this.retained.authorizationNonce.fill(0)
    this.retained.operationDomain.fill(0)
    this.retained.transactionData.fill(0)
    this.resolve = undefined
    this.reject = undefined
  }
}
