import { assetUrl } from '../assets/index.js'
import { toCeremonyError } from '../errors.js'
import { now, type OperationEvent, safeEmit } from '../events.js'
import { workerThreads } from '../threads.js'
import { abi, acvm, bbWasm, crs } from './barretenberg.assets.js'
import type { FromWorker, Preload, RawProof, ToWorker } from './protocol.js'

export type { RawProof } from './protocol.js'

export interface ProofEngineOptions {
  /** Compiled Noir circuit and matching released verification key, resolved by the asset graph. */
  circuitUrl: string
  verificationKeyUrl: string
  emit?: (event: OperationEvent) => void
  threads?: number
}

/** One boot, one witness, one proof, then unconditional worker destruction. */
export class ProofEngine {
  #worker?: Worker
  readonly #emit: (event: OperationEvent) => void
  /** Sent once the worker boots. */
  #preload?: Preload
  /** Set by the single `prove` call; preparation finishes once inputs and backend are ready. */
  #inputsAt?: number
  /** Set by the worker's `backend-ready` message. */
  #backendAt?: number
  /** Generation starts once the inputs are posted, when the worker starts it too. */
  #generating = false
  #phase: 'preparing' | 'prepared' | 'settled' = 'preparing'
  /** Witness readiness and the proof; both reject with the engine's failure. */
  readonly #ready = Promise.withResolvers<void>()
  readonly #result = Promise.withResolvers<RawProof>()

  constructor({ circuitUrl, verificationKeyUrl, emit, threads }: ProofEngineOptions) {
    const [url, keyUrl] = [circuitUrl, verificationKeyUrl].map((value) => {
      const url = new URL(value, location.href)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error('invalid circuit resource URL')
      return url.href
    })
    this.#emit = safeEmit(emit ?? (() => undefined))
    void this.#ready.promise.catch(() => {})
    void this.#result.promise.catch(() => {})
    this.#emit({ event: 'zk-proof-preparation', phase: 'started', timestamp: now() })
    this.#emit({ event: 'proof-worker-bootstrap', phase: 'started', timestamp: now() })
    try {
      this.#preload = {
        type: 'preload',
        circuitUrl: url,
        verificationKeyUrl: keyUrl,
        threads: workerThreads(threads),
        acvmUrl: assetUrl(acvm),
        abiUrl: assetUrl(abi),
        wasmPath: assetUrl(bbWasm).replace('-threads.wasm', '.wasm'),
        // Ignored by pinned bb.js; build/loaders.test.ts fails once a CRS base is honored.
        crsPath: new URL('.', assetUrl(crs[0])).href,
      }
      this.#worker = this.#spawn()
    } catch (error) {
      this.#fail(error)
    }
  }

  /** Execute one witness and proof; initialization overlaps until bb is needed. Aborting retires the worker. */
  async prove(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<RawProof> {
    if (this.#inputsAt !== undefined) throw new Error('proof engine is single-use')
    this.#inputsAt = now()
    this.#finishPreparation()
    const abort = () =>
      this.#fail(signal?.reason ?? new DOMException('Proving aborted', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await this.#ready.promise
      this.#generating = true
      try {
        this.#worker?.postMessage({ type: 'prove', inputs } satisfies ToWorker)
      } catch (error) {
        this.#fail(error)
      }
      return await this.#result.promise
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  /** Retire pending work and the worker; repeated calls after settlement are harmless. */
  destroy(): void {
    this.#fail('proof engine destroyed')
  }

  #spawn(): Worker {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      try {
        this.#onMessage(event.data)
      } catch (error) {
        this.#fail(error)
      }
    })
    // Worker file locations stay out of user-visible failure text.
    worker.addEventListener('error', (event) => this.#fail(event.message || 'proof worker failed'))
    return worker
  }

  #onMessage(message: FromWorker): void {
    if (this.#phase === 'settled') return
    switch (message.type) {
      case 'booted':
        this.#emit({
          event: 'proof-worker-bootstrap',
          phase: 'finished',
          timestamp: message.timestamp,
        })
        if (this.#preload) this.#worker?.postMessage(this.#preload)
        this.#preload = undefined
        break
      case 'event':
        this.#emit(message.event)
        break
      case 'backend-ready':
        this.#backendAt = message.timestamp
        this.#finishPreparation()
        break
      case 'witness-ready':
        this.#ready.resolve()
        break
      case 'result':
        this.#phase = 'settled'
        this.#worker?.terminate()
        this.#result.resolve(message.result)
        break
      case 'error':
        this.#fail(toCeremonyError(message.message, message.event))
        break
      default:
        this.#fail('unexpected proof worker message')
    }
  }

  #finishPreparation(): void {
    if (
      this.#phase !== 'preparing' ||
      this.#inputsAt === undefined ||
      this.#backendAt === undefined
    )
      return
    this.#phase = 'prepared'
    this.#emit({
      event: 'zk-proof-preparation',
      phase: 'finished',
      timestamp: Math.max(this.#inputsAt, this.#backendAt),
    })
  }

  #fail(reason: unknown): void {
    if (this.#phase === 'settled') return
    this.#phase = 'settled'
    this.#worker?.terminate()
    const error = toCeremonyError(
      reason,
      this.#generating ? 'zk-proof-generation' : 'zk-proof-preparation',
    )
    this.#ready.reject(error)
    this.#result.reject(error)
  }
}
