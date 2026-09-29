import { assetUrl } from '../assets/index.js'
import { ceremonyError } from '../errors.js'
import { now, type OperationEvent } from '../events.js'
import { origin, webUrl } from '../primitives.js'
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
    if (
      !webUrl(url) ||
      new URL(url).protocol !== 'https:' ||
      new URL(url).hash ||
      new URL(url).port
    )
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
      this.emit,
      event,
    )
    await session.prepare(this.#worker, this.notaryAddress)
    return session
  }
}

/** Owns one channel, its pending replies and the send-through-attestation deadline. */
class Session implements NotarizationSession {
  private phase: 'preparing' | 'prepared' | 'sending' | 'sent' | 'revealing' | 'ended' = 'preparing'
  private readonly channel = new MessageChannel()
  private readonly waiters = new Map<
    FromWorker['type'],
    { resolve: (value: FromWorker) => void; reject: (error: unknown) => void }
  >()
  private timer?: ReturnType<typeof setTimeout>
  private readonly responseSizes: Record<string, number> = {}
  private readonly abort = () => this.fail(this.signal.reason)

  constructor(
    private readonly url: string,
    private readonly signal: AbortSignal,
    private readonly failRuntime: (error: unknown) => void,
    private readonly emit?: (event: OperationEvent) => void,
    private readonly event?: string,
  ) {
    signal.addEventListener('abort', this.abort, { once: true })
    this.channel.port1.onmessageerror = () => this.fail(new Error('Invalid notarization message'))
    this.channel.port1.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data)
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
    this.phase = 'sending'
    this.timer = setTimeout(() => this.fail(new Error('Notarization request timed out')), 10000)
    const result = this.wait('sent')
    try {
      this.channel.port1.postMessage({ type: 'send', request } satisfies ToWorker)
      const { transcript } = await result
      this.signal.throwIfAborted()
      if (this.emit && this.event) {
        const bytes = transcript.received
        const end = bytes.findIndex(
          (byte, i) =>
            byte === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10,
        )
        // Raw wire sizes: headers include status/separator; body includes any chunk framing.
        if (end >= 0) {
          this.responseSizes['response-header-bytes'] = end + 4
          this.responseSizes['response-body-bytes'] = bytes.length - end - 4
        }
      }
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
      if (this.emit && this.event)
        void final.then(
          ({ attributes }) => {
            const timestamp = now()
            this.report('finished', timestamp, {
              'openings-ms': opened - started,
              'finalization-ms': timestamp - opened,
              ...attributes,
              ...this.responseSizes,
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

  private wait<T extends FromWorker['type']>(type: T): Promise<Extract<FromWorker, { type: T }>> {
    const promise = new Promise<Extract<FromWorker, { type: T }>>((resolve, reject) =>
      this.waiters.set(type, {
        resolve: (value) => resolve(value as Extract<FromWorker, { type: T }>),
        reject,
      }),
    )
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
    const waiter = this.waiters.get(message.type)
    if (!waiter || (message.type === 'attestation' && this.waiters.has('revealed'))) {
      this.fail(new Error('Unexpected notarization result'))
      return
    }
    this.waiters.delete(message.type)
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
    // Preserve the originating operation before shared-runtime cancellation rejects siblings.
    if (!this.signal.aborted && this.phase === 'revealing' && this.event)
      error = ceremonyError(error, this.event)
    for (const waiter of this.waiters.values()) waiter.reject(error)
    this.waiters.clear()
    this.cleanup()
    this.failRuntime(error)
  }

  private report(
    phase: 'started' | 'finished',
    timestamp: number,
    attributes?: Record<string, number>,
  ): void {
    if (!this.emit || !this.event) return
    try {
      this.emit({
        event: this.event,
        phase,
        timestamp,
        ...(attributes ? { instrumentation: { attributes } } : {}),
      })
    } catch {
      // Observers cannot change the session outcome.
    }
  }
}
