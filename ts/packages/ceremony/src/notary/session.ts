import { assetUrl } from '../assets/index.js'
import { toCeremonyError } from '../errors.js'
import { now, type OperationEvent, safeEmit } from '../events.js'
import { isOrigin, isWebUrl } from '../primitives.js'
import { tlsnModule, tlsnWasm } from './notary.assets.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  FromWorker,
  NotaryAttestation,
  Prepare,
  Reveals,
  ToWorker,
  Transcript,
} from './protocol.js'

/**
 * One session's setup. With the send budget it keeps X's token request well inside X's
 * 30-second code deadline, which the redirect and the Prover's load also spend.
 */
const PREPARE_TIMEOUT_MS = 10000

/** One send-through-attestation budget; setup has its own and idle bearer waiting is excluded. */
const REQUEST_TIMEOUT_MS = 10000

/** Correlated provisional openings plus a separate promise for the final attestation. */
export interface RevealResult {
  openings: readonly CommitmentOpening[]
  attestation: Promise<NotaryAttestation>
}

export interface NotarySession {
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
export class NotaryRuntime {
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
    if (!isOrigin(notaryAddress)) throw new TypeError('Invalid notary origin')
    this.signal = AbortSignal.any([signal, this.#failure.signal])
  }

  /**
   * Start target-specific setup without a bearer. `events` name the caller's fetch (setup and
   * send) and attestation (reveal) operations, so a failure names the operation it interrupts.
   */
  async prepare(
    url: string,
    events?: { fetch: string; attestation: string },
  ): Promise<NotarySession> {
    const signal = this.signal
    signal.throwIfAborted()
    const target = isWebUrl(url) ? new URL(url) : undefined
    if (target?.protocol !== 'https:' || target.hash || target.port)
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
      events && { ...events, emit: this.emit && safeEmit(this.emit) },
    )
    await session.prepare(this.#worker, this.notaryAddress)
    return session
  }
}

type Reply = Exclude<FromWorker, { type: 'error' }>

/** One awaited reply; the session awaits replies in protocol order. */
interface Waiter {
  type: Reply['type']
  resolve(reply: Reply): void
  reject(error: unknown): void
}

/** Owns one channel, its pending replies and the send-through-attestation deadline. */
class Session implements NotarySession {
  /** `busy` covers an in-flight prepare or send, failing as the fetch; `revealing` as the attestation. */
  private phase: 'busy' | 'prepared' | 'sent' | 'revealing' | 'ended' = 'busy'
  private readonly channel = new MessageChannel()
  /** Replies currently awaited, oldest first; any other reply fails the session. */
  private readonly pending: Waiter[] = []
  private timer?: ReturnType<typeof setTimeout>
  private readonly abort = () => this.fail(this.signal.reason)

  constructor(
    private readonly url: string,
    private readonly signal: AbortSignal,
    private readonly failRuntime: (error: unknown) => void,
    /** The caller's fetch and attestation events; `emit` is set when they are observed. */
    private readonly events?: {
      fetch: string
      attestation: string
      emit?: (event: OperationEvent) => void
    },
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
    this.timer = setTimeout(
      () => this.fail(new Error('Notary preparation timed out')),
      PREPARE_TIMEOUT_MS,
    )
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
      clearTimeout(this.timer)
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
    this.timer = setTimeout(
      () => this.fail(new Error('Notarization request timed out')),
      REQUEST_TIMEOUT_MS,
    )
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
    const { attestation: event, emit } = this.events ?? {}
    if (event && emit) emit({ event, phase: 'started', timestamp: started })
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
      if (event && emit)
        void final.then(
          ({ attributes }) => {
            const timestamp = now()
            const intervals = {
              'openings-ms': opened - started,
              'finalization-ms': timestamp - opened,
            }
            emit({
              event,
              phase: 'finished',
              timestamp,
              instrumentation: { attributes: { ...intervals, ...attributes } },
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

  private wait<T extends Reply['type']>(type: T): Promise<Extract<Reply, { type: T }>> {
    const { promise, resolve, reject } = Promise.withResolvers<Extract<Reply, { type: T }>>()
    void promise.catch(() => {})
    // `receive` resolves a waiter only with a reply of its own type.
    this.pending.push({ type, resolve: resolve as Waiter['resolve'], reject })
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
    // In-order delivery also requires the final attestation to follow its openings.
    const waiter = this.pending[0]
    if (waiter?.type !== message.type) {
      this.fail(new Error('Unexpected notarization result'))
      return
    }
    this.pending.shift()
    waiter.resolve(message)
    if (message.type === 'attestation') this.cleanup()
  }

  private cleanup(): void {
    this.phase = 'ended'
    clearTimeout(this.timer)
    this.channel.port1.close()
    this.signal.removeEventListener('abort', this.abort)
  }

  private fail(error: unknown): void {
    if (this.phase === 'ended') return
    // Name the interrupted operation before shared-runtime cancellation rejects siblings with it.
    if (!this.signal.aborted && this.events)
      error = toCeremonyError(
        error,
        this.phase === 'revealing' ? this.events.attestation : this.events.fetch,
      )
    for (const waiter of this.pending.splice(0)) waiter.reject(error)
    this.cleanup()
    this.failRuntime(error)
  }
}
