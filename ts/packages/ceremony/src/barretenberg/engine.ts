import { resolve as resolveAsset } from '../assets/index.js'
import { ceremonyError } from '../errors.js'
import { now, type OperationEvent } from '../events.js'
import { abi, acvm, bbWasm, crs } from './barretenberg.assets.js'

/** Browser-generated bb output; structural checks here do not establish cryptographic validity. */
export interface RawProof {
  proof: Uint8Array
  publicInputs: string[]
  runtime: { effectiveThreads: number; sharedMemory: boolean }
}

export interface ProofEngineOptions {
  /** Compiled Noir circuit and matching released verification key, resolved by the asset graph. */
  circuitUrl: string
  verificationKeyUrl: string
  emit?: (event: OperationEvent) => void
  threads?: number
}

type WorkerMessage =
  | { type: 'engine-booted'; timestamp: number }
  | { type: 'engine-ready' } // Ready for witness execution; bb may still be initializing.
  | { type: 'engine-event'; event: OperationEvent }
  | { type: 'engine-prepared'; timestamp: number }
  | { type: 'engine-result'; result: RawProof }
  | { type: 'engine-error'; error: string; event: string }

/** One boot, one witness, one proof, then unconditional worker destruction. */
export class ProofEngine {
  #worker: Worker | null = null
  readonly #emit: (event: OperationEvent) => void
  #inputsAt: number | undefined
  #backendAt: number | undefined
  #prepared = false
  readonly #ready: Promise<void>
  #resolveReady!: () => void
  #failure: Error | null = null
  #used = false
  #result: Promise<RawProof> | null = null
  #resolveResult: ((result: RawProof) => void) | null = null
  #rejectResult: ((error: Error) => void) | null = null
  #settled = false
  #preload: {
    type: 'engine-preload'
    circuitUrl: string
    verificationKeyUrl: string
    threads: number
    acvmUrl: string
    abiUrl: string
    wasmPath: string
    crsPath: string
  } | null = null

  constructor({
    circuitUrl,
    verificationKeyUrl,
    emit = () => undefined,
    threads,
  }: ProofEngineOptions) {
    const [url, keyUrl] = [circuitUrl, verificationKeyUrl].map((value) => {
      const url = new URL(value, location.href)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error('invalid circuit resource URL')
      return url.href
    })
    this.#emit = (event) => {
      try {
        emit(event)
      } catch {
        /* Observers cannot control proving. */
      }
    }
    this.#emit({ event: 'zk-proof-preparation', phase: 'started', timestamp: now() })
    this.#emit({ event: 'proof-worker-bootstrap', phase: 'started', timestamp: now() })
    this.#ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve
    })
    void this.#start(url, keyUrl, threads).catch((error: unknown) => this.#fail(error))
  }

  /** Execute one witness and proof; initialization overlaps until bb is needed. Aborting retires the worker. */
  async prove(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<RawProof> {
    if (this.#used) throw new Error('proof engine is single-use')
    this.#used = true
    this.#inputsAt = now()
    this.#finishPreparation()
    const abort = () =>
      this.#fail(signal?.reason ?? new DOMException('Proving aborted', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await this.#ready
      if (this.#failure) throw this.#failure
      this.#result = new Promise<RawProof>((resolve, reject) => {
        this.#resolveResult = resolve
        this.#rejectResult = reject
      })
      try {
        this.#worker?.postMessage({ type: 'engine-prove', inputs })
      } catch (error) {
        this.#fail(error)
      }
      return await this.#result
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  /** Retire pending work and the worker; repeated calls after settlement are harmless. */
  destroy(): void {
    if (!this.#settled) this.#fail('proof engine destroyed')
  }

  async #start(circuitUrl: string, verificationKeyUrl: string, threads?: number): Promise<void> {
    if (this.#settled) return
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    this.#worker = worker
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      try {
        this.#onMessage(event.data)
      } catch (error) {
        this.#fail(error)
      }
    })
    worker.addEventListener('error', (event) => {
      this.#fail(
        [
          event.message || 'proof worker failed',
          event.filename || 'unknown worker source',
          `${event.lineno}:${event.colno}`,
        ].join(' · '),
      )
    })
    this.#preload = {
      type: 'engine-preload',
      circuitUrl,
      verificationKeyUrl,
      threads: Math.max(1, Math.min(threads ?? 4, navigator.hardwareConcurrency || 1, 4)),
      acvmUrl: resolveAsset(acvm),
      abiUrl: resolveAsset(abi),
      wasmPath: resolveAsset(bbWasm).replace('-threads.wasm', '.wasm'),
      crsPath: new URL('.', resolveAsset(crs[0])).href,
    }
  }

  #onMessage(message: WorkerMessage): void {
    if (!message || typeof message !== 'object' || this.#settled) return
    switch (message.type) {
      case 'engine-booted':
        this.#emit({
          event: 'proof-worker-bootstrap',
          phase: 'finished',
          timestamp: message.timestamp,
        })
        if (this.#preload) {
          this.#worker?.postMessage(this.#preload)
          this.#preload = null
        }
        break
      case 'engine-event':
        this.#emit(message.event)
        break
      case 'engine-prepared':
        this.#backendAt = message.timestamp
        this.#finishPreparation()
        break
      case 'engine-ready':
        this.#resolveReady()
        break
      case 'engine-result':
        this.#settled = true
        this.#worker?.terminate()
        this.#resolveResult?.(message.result)
        break
      case 'engine-error':
        this.#fail(ceremonyError(message.error, message.event))
        break
      default:
        this.#fail('unexpected proof worker message')
    }
  }

  #finishPreparation(): void {
    if (this.#prepared || this.#inputsAt === undefined || this.#backendAt === undefined) return
    this.#prepared = true
    this.#emit({
      event: 'zk-proof-preparation',
      phase: 'finished',
      timestamp: Math.max(this.#inputsAt, this.#backendAt),
    })
  }

  #fail(reason: unknown): void {
    if (this.#settled) return
    this.#settled = true
    this.#worker?.terminate()
    const error = ceremonyError(reason, this.#used ? 'zk-proof-generation' : 'zk-proof-preparation')
    this.#failure = error
    this.#resolveReady()
    this.#rejectResult?.(error)
  }
}
