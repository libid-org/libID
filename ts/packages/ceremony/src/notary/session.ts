import { resolve as resolveAsset } from '../assets/index.js'
import { now, type OperationEvent } from '../events.js'
import { origin, webUrl } from '../primitives.js'
import type { NotaryAttestation } from './decode.js'
import type { ByteRange } from './notarize.js'
import { tlsnModule, tlsnWasm } from './notary.assets.js'

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

/** Correlated provisional openings plus a separate promise for the final attestation. */
export interface RevealResult {
  openings: readonly CommitmentOpening[]
  attestation: Promise<NotaryAttestation>
}

export interface NotarizationSession {
  /** Send one exact request after setup and return its original transcript bytes. */
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
    const emit = this.emit
    const responseSizes: Record<string, number> = {}
    function report(
      phase: 'started' | 'finished',
      timestamp: number,
      attributes?: Record<string, number>,
    ) {
      if (!emit || !event) return
      try {
        emit({
          event,
          phase,
          timestamp,
          ...(attributes ? { instrumentation: { attributes } } : {}),
        })
      } catch {
        // Observers cannot change the session outcome.
      }
    }
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
        fail(
          new Error(
            typeof event.data.message === 'string' ? event.data.message : 'Notarization failed',
          ),
        )
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
          if (emit && event) {
            const bytes = value.transcript.received
            const end = bytes.findIndex(
              (byte, i) =>
                byte === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10,
            )
            // Raw wire sizes: headers include status/separator; body includes any chunk framing.
            if (end >= 0) {
              responseSizes['response-header-bytes'] = end + 4
              responseSizes['response-body-bytes'] = bytes.length - end - 4
            }
          }
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
        const started = now()
        report('started', started)
        signal.throwIfAborted()
        const result = wait<{ openings: CommitmentOpening[] }>('revealed')
        const attestation = wait<{ attestation: NotaryAttestation }>('attestation').then(
          (v) => v.attestation,
        )
        void attestation.catch(() => {})
        try {
          port.postMessage({ type: 'reveal', reveals })
          const openings = (await result).openings
          const opened = now()
          // Parent-side intervals include worker delivery/correlation, not just TLSN execution.
          if (emit && event)
            void attestation.then(
              ({ decoded }) => {
                const timestamp = now()
                report('finished', timestamp, {
                  'openings-ms': opened - started,
                  'finalization-ms': timestamp - opened,
                  'sent-bytes': decoded.sentTranscriptLength,
                  'received-bytes': decoded.receivedTranscriptLength,
                  ...responseSizes,
                  'committed-sent-bytes': decoded.sent.commitments.reduce(
                    (sum, r) => sum + r.end - r.start,
                    0,
                  ),
                  'committed-received-bytes': decoded.received.commitments.reduce(
                    (sum, r) => sum + r.end - r.start,
                    0,
                  ),
                  'commitment-count':
                    decoded.sent.commitments.length + decoded.received.commitments.length,
                })
              },
              () => {},
            )
          return { openings, attestation }
        } catch (error) {
          fail(error)
          throw error
        }
      },
    }
  }
}
