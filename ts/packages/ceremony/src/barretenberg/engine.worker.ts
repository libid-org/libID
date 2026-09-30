import { BackendType, Barretenberg } from '@aztec/bb.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import initACVM from '@noir-lang/acvm_js'
import { Noir } from '@noir-lang/noir_js'
import initAbi from '@noir-lang/noirc_abi'
import { errorMessage, toCeremonyError } from '../errors.js'
import { now, type OperationEvent, operation } from '../events.js'
import { FIELD_BYTES, PROVING_SETTINGS, SRS_POINTS } from './parameters.js'
import type { FromWorker, Preload, RawProof, ToWorker } from './protocol.js'

/** Require the qualified shared-memory backend rather than silent single-threaded proving. */
const MIN_PROOF_THREADS = 2

type Circuit = ConstructorParameters<typeof Noir>[0]

type Api = Awaited<ReturnType<typeof Barretenberg.new>>

type ProvingCircuit = Parameters<Api['circuitProve']>[0]['circuit']

let runtime: { effectiveThreads: number; sharedMemory: boolean } | undefined

let state: 'new' | 'loading' | 'ready' | 'proving' | 'done' = 'new'

let ready: { noir: Noir; circuit: ProvingCircuit } | null = null

let backend: Promise<Api> | null = null

const send = (message: FromWorker): void => self.postMessage(message)

const emit = (event: OperationEvent) => send({ type: 'event', event })

const span = <T>(event: string, work: () => Promise<T>) => operation(emit, event, work)

async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Response(Uint8Array.from(bytes)).body!.pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function destroyBackend(): Promise<void> {
  const pending = backend
  backend = null
  return pending ? pending.then((api) => api.destroy()) : Promise.resolve()
}

function fail(error: unknown): void {
  if (state === 'done') return
  const event = state === 'proving' ? 'zk-proof-generation' : 'zk-proof-preparation'
  state = 'done'
  ready = null
  // Also releases a backend that finishes initializing after a sibling failed.
  void destroyBackend().catch(() => {})
  const failure = toCeremonyError(error, event)
  send({ type: 'error', message: errorMessage(failure), event: failure.event })
}

/** Start bb initialization alongside circuit/key and Noir loading; witness readiness does not await bb. */
async function preload(message: Preload): Promise<void> {
  if (state !== 'new') throw new Error('Duplicate engine initialization')
  state = 'loading'
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('proof worker requires cross-origin isolation')
  }
  backend = span('proof-backend-initialization', async () => {
    const api = await Barretenberg.new({
      backend: BackendType.Wasm,
      threads: message.threads,
      logger: (message) => {
        const match = /threads: ([0-9]+); shared memory: (true|false)/.exec(message)
        if (match)
          runtime = { effectiveThreads: Number(match[1]), sharedMemory: match[2] === 'true' }
      },
      srsSize: SRS_POINTS,
      wasmPath: message.wasmPath,
      crsPath: message.crsPath,
    })
    if (!runtime?.sharedMemory || runtime.effectiveThreads < MIN_PROOF_THREADS) {
      await api.destroy()
      throw new Error('Multithreaded backend unavailable')
    }
    return api
  })
  void backend.catch(fail)
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
          bytecode: await inflate(Uint8Array.from(atob(compiled.bytecode), (c) => c.charCodeAt(0))),
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
  if (state !== 'loading') return
  ready = { noir: new Noir(compiled), circuit }
  state = 'ready'
  send({ type: 'witness-ready' })
  void backend
    .then(() => {
      if (state !== 'done') send({ type: 'backend-ready', timestamp: now() })
    })
    .catch(fail)
}

async function prove(message: Extract<ToWorker, { type: 'prove' }>): Promise<void> {
  if (!ready || !backend || state !== 'ready') throw new Error('proof engine is not ready')
  state = 'proving'
  emit({ event: 'zk-proof-generation', phase: 'started', timestamp: now() })
  const { noir, circuit } = ready
  const [api, { witness }] = await Promise.all([
    backend,
    span('witness', () => noir.execute(message.inputs as Parameters<typeof noir.execute>[0])),
  ])
  if (state !== 'proving') return
  const generated = await span('proof', async () =>
    api.circuitProve({
      circuit,
      witness: await inflate(witness),
      settings: PROVING_SETTINGS,
    }),
  )
  if (state !== 'proving') return
  const proof = new Uint8Array(generated.proof.length * FIELD_BYTES)
  generated.proof.forEach((field, i) => {
    proof.set(field, i * FIELD_BYTES)
  })
  const result: RawProof = {
    proof,
    publicInputs: generated.publicInputs.map((field) => `0x${bytesToHex(field)}`),
    runtime: runtime!,
  }
  emit({ event: 'zk-proof-generation', phase: 'finished', timestamp: now() })
  await span('proof-backend-destroy', destroyBackend)
  if (state !== 'proving') return
  ready = null
  state = 'done'
  send({ type: 'result', result })
}

send({ type: 'booted', timestamp: now() })

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const work = event.data.type === 'preload' ? preload(event.data) : prove(event.data)
  void work.catch(fail)
})
