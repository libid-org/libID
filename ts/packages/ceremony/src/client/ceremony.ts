import { LedgerId } from '@libid/ledger'
import { hasExactKeys, isRecord } from '../primitives.js'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import {
  AbortCeremony,
  type AppStartProver,
  CancelCeremony,
  PrefetchStarted,
  ProverIdentityProof,
  ProverNotifyEvent,
  ProverReady,
  UUID,
  type PlatformStep,
} from '../ccdp/index.js'
import { oauthState, prefetchFragment, route } from '../ccdp/navigation.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../platforms/authorization.js'
import {
  assembleResult,
  implementationFor,
  greatestCommonVersion,
  platforms,
  supportedPlatforms,
  type IdentityResult,
  type PlatformId,
} from '../platforms/index.js'
import { type CeremonyConfig, fetchCeremonyConfig } from './config.js'
export type CeremonyStage = 'authorization' | 'proof-generation'
export interface CeremonyEvent {
  stage: CeremonyStage
  platformStep: PlatformStep | null
  timestamp: number
}
export interface Ceremony<P extends PlatformId = PlatformId> {
  readonly launchUrl: string
  onEvent(listener: (event: CeremonyEvent) => void): () => void
  proveUserIdentity(): Promise<IdentityResult<P>>
  cancel(): Promise<void>
}
interface Input<P extends PlatformId> {
  connection: PopupConnection<Message>
  ledgerId: string
  chainId: Uint8Array
  platformId: P
  operationDomain: Uint8Array
  transactionData: Uint8Array
}
export interface CeremonyClient {
  readonly enabledPlatforms: readonly PlatformId[]
  new: <P extends PlatformId>(
    conn: PopupConnection<Message>,
    ceremonyId: string,
    ledgerId: LedgerId,
    platformId: P,
    operationDomain: Uint8Array,
    transactionData: Uint8Array,
  ) => Ceremony<P>
}
export async function createCeremonyClient(options: {
  oauthBridge: string
}): Promise<CeremonyClient> {
  if (!isRecord(options) || !hasExactKeys(options, ['oauthBridge']))
    throw new TypeError('Invalid client options')
  return clientFromConfig(await fetchCeremonyConfig(options.oauthBridge))
}
export function clientFromConfig(config: CeremonyConfig): CeremonyClient {
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
      if (!ledgerId || typeof ledgerId.encode !== 'function')
        throw new TypeError('Invalid ledger identity')
      const encodedLedgerId = ledgerId.encode()
      const hash = LedgerId.decode(encodedLedgerId).hash()
      if (!(hash instanceof Uint8Array) || hash.length !== 32)
        throw new TypeError('Ledger hash must be 32 bytes')
      const chainId = Uint8Array.from(hash)
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
          ledgerId: encodedLedgerId,
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
  private stage: CeremonyStage = 'authorization'
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
      ledgerId: input.ledgerId,
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
  private emit(
    platformStep: PlatformStep | null = null,
    timestamp = performance.timeOrigin + performance.now(),
  ): void {
    for (const listener of this.listeners) {
      try {
        listener({
          stage: this.stage,
          platformStep: platformStep ? { ...platformStep } : null,
          timestamp,
        })
      } catch {
        /* Observers cannot affect ceremony authority. */
      }
    }
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
    if (previous?.active)
      return Promise.reject(new Error('Connection already has an active ceremony'))
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
      this.listen(PrefetchStarted, () => {
        this.expect('prefetch')
        this.state = 'oauth'
        const url = this.authorizationUrl
        this.authorizationUrl = ''
        void this.connection
          .navigateAway(url)
          .catch(() => this.fail(new Error('OAuth navigation failed')))
      })
      this.listen(ProverReady, () => {
        this.expect('oauth')
        this.state = 'proving'
        this.stage = 'proof-generation'
        this.emit()
        if (this.state === 'proving') this.connection.send({ ...this.start })
      })
      this.listen(ProverNotifyEvent, (m) => {
        this.expect('proving')
        if (m.platformStep.progress < this.progress) return
        this.progress = m.platformStep.progress
        this.emit(m.platformStep, m.timestamp)
      })
      this.listen(ProverIdentityProof, (m) => {
        this.expect('proving')
        this.resolve?.(
          assembleResult(
            this.platform,
            this.version,
            m,
            this.start.clientId,
            this.retained.authorizationNonce,
          ),
        )
        this.cleanup()
      })
      this.listen(CancelCeremony, () => {
        this.expect('proving')
        this.resolve?.({ status: 'denied' })
        this.cleanup()
      })
      this.listen(AbortCeremony, () => this.fail(new Error('Ceremony aborted')))
      void this.connection.ready.catch(() => this.fail(new Error('Popup connection failed')))
      void this.connection.closed.then(() => this.fail(new Error('Popup connection ended')))
      this.emit()
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
    if (active)
      try {
        this.connection.send({ type: 'cancel-ceremony' })
      } catch {
        /* Best effort; local cancellation already won. */
      }
  }
  private fail(error: Error): void {
    if (this.state === 'done') return
    this.reject?.(error)
    this.cleanup()
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
