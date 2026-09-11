import { resolve as resolveAsset } from '../assets/index.js'
import { origin, webUrl } from '../ccdp/index.js'
import { ceremonyError } from '../errors.js'
import type { NotaryAttestation } from '../platforms/types.js'
import { tlsnModule, tlsnWasm } from './notary.assets.js'
import type { ByteRange } from './notarize.js'
export interface ExactHttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Readonly<Record<string, Uint8Array>>
  body: Uint8Array
}
export interface Transcript {
  sent: Uint8Array
  received: Uint8Array
}
export interface Reveals {
  sent: readonly ByteRange[]
  received: readonly ByteRange[]
}
export interface CommitmentOpening extends ByteRange {
  direction: 'sent' | 'received'
  blinder: Uint8Array
}
export interface RevealResult {
  openings: readonly CommitmentOpening[]
  attestation: Promise<NotaryAttestation>
}
export interface NotarizationSession {
  send(request: ExactHttpRequest): Promise<Transcript>
  reveal(reveals: Reveals): Promise<RevealResult>
}
/** One ceremony-owned WASM runtime; each prepare creates a separate TLS session. */
export class Notarization {
  #worker?: Worker
  #failure = new AbortController()
  readonly signal: AbortSignal
  constructor(
    private readonly notaryAddress: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    if (!origin(notaryAddress)) throw new TypeError('Invalid notary origin')
    this.signal = AbortSignal.any([signal, this.#failure.signal])
  }
  async prepare(url: string): Promise<NotarizationSession> {
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
      worker.onerror = () => this.#failure.abort(ceremonyError(undefined, 'notarization'))
    }
    const worker = this.#worker
    const { port1: port, port2 } = new MessageChannel()
    const failRuntime = (error: unknown) => this.#failure.abort(error)
    let stage = 'preparing',
      ended = false
    const waiters = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    >()
    function wait<T>(type: string): Promise<T> {
      const promise = new Promise<T>((resolve, reject) =>
        waiters.set(type, { resolve: (v) => resolve(v as T), reject }),
      )
      void promise.catch(() => {})
      return promise
    }
    function cleanup() {
      ended = true
      port.close()
      signal.removeEventListener('abort', abort)
    }
    function fail(error: unknown) {
      if (ended) return
      for (const w of waiters.values()) w.reject(error)
      waiters.clear()
      cleanup()
      failRuntime(error)
    }
    function abort() {
      fail(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    port.onmessageerror = () => fail(new Error('Invalid notarization message'))
    port.onmessage = (event) => {
      if (ended) return
      if (event.data.type === 'error') {
        fail(ceremonyError(undefined, 'notarization'))
        return
      }
      const waiter = waiters.get(event.data.type)
      if (!waiter) {
        fail(new Error('Unexpected notarization result'))
        return
      }
      waiters.delete(event.data.type)
      waiter.resolve(event.data)
      if (event.data.type === 'attestation') cleanup()
    }
    const prepared = wait('prepared')
    try {
      worker.postMessage(
        {
          type: 'prepare',
          url,
          moduleUrl: resolveAsset(tlsnModule),
          wasmUrl: resolveAsset(tlsnWasm),
          notaryAddress: this.notaryAddress,
          port: port2,
        },
        [port2],
      )
      await prepared
      signal.throwIfAborted()
    } catch (error) {
      port2.close()
      fail(error)
      throw error
    }
    stage = 'prepared'
    return {
      async send(request) {
        signal.throwIfAborted()
        if (ended || stage !== 'prepared' || request.url !== url)
          throw new Error('Invalid notarization send')
        stage = 'sending'
        const result = wait<{ transcript: Transcript }>('sent')
        try {
          port.postMessage({ type: 'send', request })
          const value = await result
          stage = 'sent'
          return value.transcript
        } catch (error) {
          fail(error)
          throw error
        }
      },
      async reveal(reveals) {
        signal.throwIfAborted()
        if (ended || stage !== 'sent') throw new Error('Invalid notarization reveal')
        stage = 'revealing'
        const result = wait<{ openings: CommitmentOpening[] }>('revealed')
        const attestation = wait<{ attestation: NotaryAttestation }>('attestation').then(
          (v) => v.attestation,
        )
        void attestation.catch(() => {})
        try {
          port.postMessage({ type: 'reveal', reveals })
          return { openings: (await result).openings, attestation }
        } catch (error) {
          fail(error)
          throw error
        }
      },
    }
  }
}
