import { assetUrl } from '../assets/index.js'
import { ceremonyError } from '../errors.js'
import { now, type OperationEvent } from '../events.js'
import { origin, webUrl } from '../primitives.js'
import { safeEmit } from '../workers.js'
import type { NotaryAttestation } from './decode.js'
import { tlsnModule, tlsnWasm } from './notary.assets.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  FromWorker,
  Prepare,
  Reveals,
  ToWorker,
  Transcript,
} from './protocol.js'

/** Correlated provisional openings plus a separate promise for the final attestation. */
export interface RevealResult {
  openings: readonly CommitmentOpening[]
  attestation: Promise<NotaryAttestation>
}

export interface NotarizationSession {
  /** Send once after setup; starts the 10-second deadline through final attestation. */
  send(request: ExactHttpRequest): Promise<Transcript>
  /** Reveal once after send; proof preparation may use openings before attestation completes. */
  reveal(reveals: Reveals): Promise<RevealResult>
}

/**
 * One ceremony-owned WASM runtime and thread pool, with a separate TLS session per prepare.
 * The supplied abort signal releases the worker; any session failure also aborts sibling work.
 * Final outputs preserve signed bytes and correlate openings without verifying notary signatures.
 */
export class Notarization {
  #worker?: Worker
  #failure = new AbortController()
  /** Caller cancellation combined with runtime failure, including failures after prepare resolves. */
  readonly signal: AbortSignal

  constructor(
    private readonly notaryAddress: string,
    signal: AbortSignal,
    private readonly emit?: (event: OperationEvent) => void,
  ) {
    signal.throwIfAborted()
    if (!origin(notaryAddress)) throw new TypeError('Invalid notary origin')
    this.signal = AbortSignal.any([signal, this.#failure.signal])
  }

  /** Start target-specific setup without a bearer; event names the later reveal/attestation operation. */
  async prepare(url: string, event?: string): Promise<NotarizationSession> {
    const signal = this.signal
    signal.throwIfAborted()
    const target = webUrl(url) ? new URL(url) : undefined
    if (!target || target.protocol !== 'https:' || target.hash || target.port)
      throw new TypeError('Invalid notarization target')
    if (!this.#worker) {
      const worker = new Worker(new URL('./session.worker.ts', import.meta.url), { type: 'module' })
      this.#worker = worker
      signal.addEventListener('abort', () => worker.terminate(), { once: true })
      worker.onerror = (event) =>
        this.#failure.abort(new Error(event.message || 'Notary worker failed'))
    }
    const session = new Session(
      url,
      this.signal,
      (error) => this.#failure.abort(error),
      event ? { event, emit: this.emit && safeEmit(this.emit) } : undefined,
    )
    await session.prepare(this.#worker, this.notaryAddress)
    return session
  }
}

type Reply = Exclude<FromWorker, { type: 'error' }>

type Replies = { [T in Reply['type']]: Extract<Reply, { type: T }> }

/** Owns one channel, its pending replies and the send-through-attestation deadline. */
class Session implements NotarizationSession {
  /** `busy` covers an in-flight prepare or send; reveal failures carry their operation. */
  private phase: 'busy' | 'prepared' | 'sent' | 'revealing' | 'ended' = 'busy'
  private readonly channel = new MessageChannel()
  private readonly replies: { [T in keyof Replies]: PromiseWithResolvers<Replies[T]> } = {
    prepared: Promise.withResolvers(),
    sent: Promise.withResolvers(),
    revealed: Promise.withResolvers(),
    attestation: Promise.withResolvers(),
  }
  /** Replies currently awaited; any other reply fails the session. */
  private readonly pending = new Set<keyof Replies>()
  private timer?: ReturnType<typeof setTimeout>
  private readonly abort = () => this.fail(this.signal.reason)

  constructor(
    private readonly url: string,
    private readonly signal: AbortSignal,
    private readonly failRuntime: (error: unknown) => void,
    /** The platform's reveal/attestation operation; `emit` is set when it is observed. */
    private readonly observer?: { event: string; emit?: (event: OperationEvent) => void },
  ) {
    signal.addEventListener('abort', this.abort, { once: true })
    this.channel.port1.onmessageerror = () => this.fail(new Error('Invalid notarization message'))
    this.channel.port1.onmessage = (event: MessageEvent<FromWorker>) => {
      try {
        this.receive(event.data)
      } catch (error) {
        this.fail(error)
      }
    }
  }

  async prepare(worker: Worker, notaryAddress: string): Promise<void> {
    const prepared = this.wait('prepared')
    try {
      worker.postMessage(
        {
          type: 'prepare',
          url: this.url,
          moduleUrl: assetUrl(tlsnModule),
          wasmUrl: assetUrl(tlsnWasm),
          notaryAddress,
          port: this.channel.port2,
        } satisfies Prepare,
        [this.channel.port2],
      )
      await prepared
      this.signal.throwIfAborted()
      this.phase = 'prepared'
    } catch (error) {
      this.channel.port2.close()
      this.fail(error)
      throw error
    }
  }

  async send(request: ExactHttpRequest): Promise<Transcript> {
    this.signal.throwIfAborted()
    if (this.phase !== 'prepared' || request.url !== this.url)
      throw new Error('Invalid notarization send')
    this.phase = 'busy'
    this.timer = setTimeout(() => this.fail(new Error('Notarization request timed out')), 10000)
    const result = this.wait('sent')
    try {
      this.channel.port1.postMessage({ type: 'send', request } satisfies ToWorker)
      const { transcript } = await result
      this.signal.throwIfAborted()
      this.phase = 'sent'
      return transcript
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  async reveal(reveals: Reveals): Promise<RevealResult> {
    this.signal.throwIfAborted()
    if (this.phase !== 'sent') throw new Error('Invalid notarization reveal')
    this.phase = 'revealing'
    const started = now()
    this.report('started', started)
    this.signal.throwIfAborted()
    const result = this.wait('revealed')
    const final = this.wait('attestation')
    const attestation = final.then((value) => value.attestation)
    void attestation.catch(() => {})
    try {
      this.channel.port1.postMessage({ type: 'reveal', reveals } satisfies ToWorker)
      const { openings } = await result
      const opened = now()
      // Parent-side intervals include worker delivery/correlation, not just TLSN execution.
      if (this.observer?.emit)
        void final.then(
          ({ attributes }) => {
            const timestamp = now()
            this.report('finished', timestamp, {
              'openings-ms': opened - started,
              'finalization-ms': timestamp - opened,
              ...attributes,
            })
          },
          () => {},
        )
      return { openings, attestation }
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  private wait<T extends keyof Replies>(type: T): Promise<Replies[T]> {
    this.pending.add(type)
    const { promise } = this.replies[type]
    void promise.catch(() => {})
    return promise
  }

  private receive(message: FromWorker): void {
    if (this.phase === 'ended') return
    if (message.type === 'error') {
      this.fail(
        new Error(typeof message.message === 'string' ? message.message : 'Notarization failed'),
      )
      return
    }
    if (!this.settle(message)) this.fail(new Error('Unexpected notarization result'))
    else if (message.type === 'attestation') this.cleanup()
  }

  /** Deliver a reply to its pending waiter; the final attestation must follow its openings. */
  private settle<T extends keyof Replies>(message: Replies[T] & { type: T }): boolean {
    const { type } = message
    if (!this.pending.has(type) || (type === 'attestation' && this.pending.has('revealed')))
      return false
    this.pending.delete(type)
    this.replies[type].resolve(message)
    return true
  }

  private cleanup(): void {
    this.phase = 'ended'
    clearTimeout(this.timer)
    this.channel.port1.close()
    this.signal.removeEventListener('abort', this.abort)
  }

  private fail(error: unknown): void {
    if (this.phase === 'ended') return
    // Preserve the originating operation before shared-runtime cancellation rejects siblings.
    if (!this.signal.aborted && this.phase === 'revealing' && this.observer)
      error = ceremonyError(error, this.observer.event)
    for (const type of this.pending) this.replies[type].reject(error)
    this.pending.clear()
    this.cleanup()
    this.failRuntime(error)
  }

  private report(
    phase: 'started' | 'finished',
    timestamp: number,
    attributes?: Record<string, number>,
  ): void {
    this.observer?.emit?.({
      event: this.observer.event,
      phase,
      timestamp,
      ...(attributes ? { instrumentation: { attributes } } : {}),
    })
  }
}
