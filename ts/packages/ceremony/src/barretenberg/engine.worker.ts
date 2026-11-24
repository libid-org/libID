import { BackendType, Barretenberg, Crs } from '@aztec-foundation/bb.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import initACVM from '@noir-lang/acvm_js'
import { Noir } from '@noir-lang/noir_js'
import initAbi from '@noir-lang/noirc_abi'
import { errorMessage, toCeremonyError } from '../errors.js'
import { now, type OperationEvent, operation } from '../events.js'
import { workerThreads } from '../threads.js'
import { FIELD_BYTES, PROVING_SETTINGS } from './parameters.js'
import type { FromWorker, Preload, RawProof, ToWorker } from './protocol.js'

/** Refuse single-threaded proving after applying the worker CPU cap. */
const MIN_PROOF_THREADS = 2

type Circuit = ConstructorParameters<typeof Noir>[0]

type Api = Awaited<ReturnType<typeof Barretenberg.new>>

type ProvingCircuit = Parameters<Api['circuitProve']>[0]['circuit']

const send = (message: FromWorker): void => self.postMessage(message)

const emit = (event: OperationEvent) => send({ type: 'event', event })

const span = <T>(event: string, work: () => Promise<T>) => operation(emit, event, work)

/**
 * A backend holding only the BN254 SRS. bb.js's own setup also fetches 4 MiB of Grumpkin points,
 * which ZK-Honk/Keccak proofs never read; this mirrors the rest of that setup, overlapping WASM
 * thread-pool startup with CRS loading and keeping decompressed-point caching off the proving
 * critical path. A failed setup releases the backend, including one that resolves afterwards.
 */
async function bn254Backend(
  threads: number,
  { wasmPath, crsPath, srsPoints }: Preload,
): Promise<{ api: Api; caching: Promise<void> }> {
  const creating = Barretenberg.new({
    backend: BackendType.Wasm,
    threads,
    wasmPath,
    crsPath,
    skipSrsInit: true,
  })
  const loading = Crs.new(srsPoints, crsPath)
  let api: Api
  let crs: Crs
  try {
    ;[api, crs] = await Promise.all([creating, loading])
  } catch (error) {
    void creating.then(
      (late) => late.destroy().catch(() => {}),
      () => {},
    )
    throw error
  }
  try {
    const { pointsBuf } = await api.srsInitSrs({
      pointsBuf: crs.getG1Data(),
      numPoints: crs.numPoints,
      g2Point: crs.getG2Data(),
    })
    // Writing decompressed points to IndexedDB only warms future ceremonies; do not hold proving.
    const caching =
      pointsBuf.length > 0
        ? Promise.resolve()
            .then(() => crs.cacheUncompressed(pointsBuf))
            .catch(() => {})
        : Promise.resolve()
    return { api, caching }
  } catch (error) {
    await api.destroy().catch(() => {})
    throw error
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Response(Uint8Array.from(bytes)).body!.pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** One circuit's backend, witness readiness and single proof, from preload to result. */
class EngineWorker {
  #state: 'new' | 'loading' | 'ready' | 'proving' | 'done' = 'new'
  #ready: { noir: Noir; circuit: ProvingCircuit } | null = null
  #backend: Promise<{ api: Api; caching: Promise<void> }> | null = null

  receive(message: ToWorker): void {
    const work = message.type === 'preload' ? this.#preload(message) : this.#prove(message)
    void work.catch((error) => this.#fail(error))
  }

  #destroyBackend(): Promise<void> {
    const pending = this.#backend
    this.#backend = null
    return pending
      ? pending.then(async ({ api, caching }) => {
          try {
            await api.destroy()
          } finally {
            await caching
          }
        })
      : Promise.resolve()
  }

  #fail(error: unknown): void {
    if (this.#state === 'done') return
    const event = this.#state === 'proving' ? 'zk-proof-generation' : 'zk-proof-preparation'
    this.#state = 'done'
    this.#ready = null
    // Also releases a backend that finishes initializing after a sibling failed.
    void this.#destroyBackend().catch(() => {})
    const failure = toCeremonyError(error, event)
    send({ type: 'error', message: errorMessage(failure), event: failure.event })
  }

  /** Start bb initialization alongside circuit/key and Noir loading; witness readiness does not await bb. */
  async #preload(message: Preload): Promise<void> {
    if (this.#state !== 'new') throw new Error('Duplicate engine initialization')
    this.#state = 'loading'
    // bb.js shares its memory exactly when SharedArrayBuffer and isolation are present.
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('Proof worker requires cross-origin isolation')
    }
    const threads = workerThreads(message.threads)
    if (!Number.isInteger(threads) || threads < MIN_PROOF_THREADS)
      throw new Error('Multithreaded backend unavailable')
    const backend = span('proof-backend-initialization', () => bn254Backend(threads, message))
    this.#backend = backend
    void backend.catch((error) => this.#fail(error))
    const [{ compiled, circuit }] = await Promise.all([
      span('proof-circuit-load', async () => {
        const [response, keyResponse] = await Promise.all(
          [message.circuitUrl, message.verificationKeyUrl].map((url) =>
            fetch(url, { credentials: 'same-origin', redirect: 'error' }),
          ),
        )
        if (!response.ok || !keyResponse.ok) throw new Error('Circuit resource request failed')
        const [compiled, key] = await Promise.all([
          response.json() as Promise<Circuit>,
          keyResponse.arrayBuffer(),
        ])
        // An empty key asks bb to recompute it; a missing release artifact must fail instead.
        if (!key.byteLength) throw new Error('Empty verification key')
        return {
          compiled,
          circuit: {
            name: 'circuit',
            bytecode: await inflate(
              Uint8Array.from(atob(compiled.bytecode), (c) => c.charCodeAt(0)),
            ),
            verificationKey: new Uint8Array(key),
          },
        }
      }),
      span('proof-wasm-load', async () => {
        // Bundled worker URLs cannot infer wasm-bindgen's original sibling WASM paths.
        // Noir must share these initialized ACVM/ABI modules, not load a second copy.
        await Promise.all([
          initACVM({ module_or_path: message.acvmUrl }),
          initAbi({ module_or_path: message.abiUrl }),
        ])
      }),
    ])
    if (this.#state !== 'loading') return
    this.#ready = { noir: new Noir(compiled), circuit }
    this.#state = 'ready'
    send({ type: 'witness-ready' })
    void backend
      .then(() => {
        if (this.#state !== 'done') send({ type: 'backend-ready', timestamp: now() })
      })
      .catch((error) => this.#fail(error))
  }

  async #prove(message: Extract<ToWorker, { type: 'prove' }>): Promise<void> {
    const ready = this.#ready
    const backend = this.#backend
    if (!ready || !backend || this.#state !== 'ready') throw new Error('Proof engine is not ready')
    this.#state = 'proving'
    emit({ event: 'zk-proof-generation', phase: 'started', timestamp: now() })
    const { noir, circuit } = ready
    const [{ api }, { witness }] = await Promise.all([
      backend,
      span('witness', () =>
        noir.execute(message.inputs as Parameters<typeof noir.execute>[0]).catch((error) => {
          // Only circuits built with --circuit-debug-symbols carry a source call stack.
          if (error?.noirCallStack) console.error('[ceremony] Noir call stack', error.noirCallStack)
          throw error
        }),
      ),
    ])
    if (this.#state !== 'proving') return
    const generated = await span('proof', async () =>
      api.circuitProve({
        circuit,
        witness: await inflate(witness),
        settings: PROVING_SETTINGS,
      }),
    )
    if (this.#state !== 'proving') return
    const proof = new Uint8Array(generated.proof.length * FIELD_BYTES)
    generated.proof.forEach((field, i) => {
      proof.set(field, i * FIELD_BYTES)
    })
    const result: RawProof = {
      proof,
      publicInputs: generated.publicInputs.map((field) => `0x${bytesToHex(field)}`),
    }
    emit({ event: 'zk-proof-generation', phase: 'finished', timestamp: now() })
    // The proof is finished; failing to release the backend cannot take it back.
    await span('proof-backend-destroy', () => this.#destroyBackend()).catch(() => {})
    if (this.#state !== 'proving') return
    this.#ready = null
    this.#state = 'done'
    send({ type: 'result', result })
  }
}

const engine = new EngineWorker()

send({ type: 'booted', timestamp: now() })

self.addEventListener('message', (event: MessageEvent<ToWorker>) => engine.receive(event.data))
