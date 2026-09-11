import { ceremonyError } from '../errors.js'
import { resolve as resolveAsset } from '../assets.js'
import type { PlatformStep } from '../ccdp/index.js'
import { abi, acvm, bbWasm, crs } from './bb/assets.js'
import { Progress, type ProgressSpan } from './progress.js'

export const PROOF_ENGINE_SPANS = [
  { code: 'proof-worker-bootstrap', label: 'Starting prover', weight: 1 },
  { code: 'proof-wasm-load', label: 'Loading prover', weight: 8 },
  { code: 'proof-circuit-load', label: 'Loading circuit', weight: 4 },
  { code: 'proof-backend-initialization', label: 'Preparing proof system', weight: 12 },
  { code: 'witness', label: 'Generating witness', weight: 20 },
  { code: 'proof', label: 'Generating proof', weight: 54 },
  { code: 'proof-backend-destroy', label: 'Finishing proof', weight: 1 },
] satisfies readonly ProgressSpan[]

export interface RawProof {
  proof: Uint8Array
  publicInputs: string[]
  runtime: { effectiveThreads: number; sharedMemory: boolean }
}

export interface ProofEngineOptions {
  circuitUrl: string
  verificationKeyUrl: string
  onProgress?: (step: PlatformStep, timestamp: number) => void
  threads?: number
}

type WorkerMessage =
  | { type: 'engine-booted' }
  | { type: 'engine-ready' }
  | { type: 'engine-span'; code: string; status: PlatformStep['status'] }
  | { type: 'engine-result'; result: RawProof }
  | { type: 'engine-error'; error: string }

/** One boot, one witness, one proof, then unconditional worker destruction. */
export class ProofEngine {
  #worker: Worker | null = null
  readonly #progress: Progress
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
    onProgress = () => undefined,
    threads,
  }: ProofEngineOptions) {
    const [url, keyUrl] = [circuitUrl, verificationKeyUrl].map((value) => {
      const url = new URL(value, location.href)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error('invalid circuit resource URL')
      return url.href
    })
    this.#progress = new Progress(PROOF_ENGINE_SPANS, (step) => {
      try {
        onProgress(step, performance.timeOrigin + performance.now())
      } catch {
        // Progress is advisory; an observer cannot control proving.
      }
    })
    this.#progress.start('proof-worker-bootstrap')
    this.#ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve
    })
    void this.#start(url, keyUrl, threads).catch((error: unknown) => this.#fail(error))
  }

  async prove(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<RawProof> {
    if (this.#used) throw new Error('proof engine is single-use')
    this.#used = true
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
      wasmPath: resolveAsset(bbWasm).replace('-threads.wasm.gz', '.wasm.gz'),
      crsPath: new URL('.', resolveAsset(crs[0])).href,
    }
  }

  #onMessage(message: WorkerMessage): void {
    if (!message || typeof message !== 'object' || this.#settled) return
    switch (message.type) {
      case 'engine-booted':
        this.#progress.complete('proof-worker-bootstrap')
        if (this.#preload) {
          this.#worker?.postMessage(this.#preload)
          this.#preload = null
        }
        break
      case 'engine-span':
        if (message.status === 'started') this.#progress.start(message.code)
        else if (message.status === 'completed') this.#progress.complete(message.code)
        else this.#progress.fail(message.code)
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
        this.#fail(message.error)
        break
      default:
        this.#fail('unexpected proof worker message')
    }
  }

  #fail(reason: unknown): void {
    if (this.#settled) return
    this.#settled = true
    this.#worker?.terminate()
    try {
      this.#progress.failActive()
    } catch {
      // Preserve the original failure when lifecycle state is already invalid.
    }
    const error = ceremonyError(reason, 'proof')
    this.#failure = error
    this.#resolveReady()
    this.#rejectResult?.(error)
  }
}
