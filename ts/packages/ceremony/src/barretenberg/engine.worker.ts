import initACVM from '@noir-lang/acvm_js'
import { Noir } from '@noir-lang/noir_js'
import initAbi from '@noir-lang/noirc_abi'
import { BackendType, Barretenberg } from '@aztec/bb.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { RawProof } from './engine.js'
import { SRS_SIZE } from './barretenberg.assets.js'

type Circuit = ConstructorParameters<typeof Noir>[0]
type Api = Awaited<ReturnType<typeof Barretenberg.new>>
type ProvingCircuit = Parameters<Api['circuitProve']>[0]['circuit']

type Preload = {
  type: 'engine-preload'
  circuitUrl: string
  verificationKeyUrl: string
  threads: number
  acvmUrl: string
  abiUrl: string
  wasmPath: string
  crsPath: string
}
type Prove = { type: 'engine-prove'; inputs: Record<string, unknown> }

let runtime: { effectiveThreads: number; sharedMemory: boolean } | undefined
let state: 'new' | 'loading' | 'ready' | 'proving' | 'done' = 'new'
let ready: { noir: Noir; circuit: ProvingCircuit } | null = null
let backend: Promise<Api> | null = null

const send = (message: unknown): void => self.postMessage(message)

async function span<T>(code: string, work: () => Promise<T>): Promise<T> {
  send({ type: 'engine-span', code, status: 'started' })
  try {
    const result = await work()
    send({ type: 'engine-span', code, status: 'completed' })
    return result
  } catch (error) {
    send({ type: 'engine-span', code, status: 'failed' })
    throw error
  }
}

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

function fail(): void {
  if (state === 'done') return
  state = 'done'
  ready = null
  // Also releases a backend that finishes initializing after a sibling failed.
  void destroyBackend().catch(() => {})
  send({ type: 'engine-error', error: 'Proof engine failed' })
}

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
      srsSize: SRS_SIZE,
      wasmPath: message.wasmPath,
      crsPath: message.crsPath,
    })
    if (!runtime?.sharedMemory || runtime.effectiveThreads < 2) {
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
      await Promise.all([
        initACVM({ module_or_path: message.acvmUrl }),
        initAbi({ module_or_path: message.abiUrl }),
      ])
    }),
  ])
  if (state !== 'loading') return
  ready = { noir: new Noir(compiled), circuit }
  state = 'ready'
  send({ type: 'engine-ready' })
}

async function prove(message: Prove): Promise<void> {
  if (!ready || !backend || state !== 'ready') throw new Error('proof engine is not ready')
  state = 'proving'
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
      // Exact bb.js 5.2.0 settings for verifierTarget: 'evm' (ZK-Honk/Keccak).
      settings: {
        ipaAccumulation: false,
        oracleHashType: 'keccak',
        disableZk: false,
        optimizedSolidityVerifier: false,
      },
    }),
  )
  if (state !== 'proving') return
  await span('proof-backend-destroy', destroyBackend)
  if (state !== 'proving') return
  ready = null
  const proof = new Uint8Array(generated.proof.length * 32)
  generated.proof.forEach((field, i) => {
    proof.set(field, i * 32)
  })
  const result: RawProof = {
    proof,
    publicInputs: generated.publicInputs.map((field) => `0x${bytesToHex(field)}`),
    runtime: runtime!,
  }
  state = 'done'
  send({ type: 'engine-result', result })
}

send({ type: 'engine-booted' })
self.addEventListener('message', (event: MessageEvent<Preload | Prove>) => {
  const work = event.data.type === 'engine-preload' ? preload(event.data) : prove(event.data)
  void work.catch(fail)
})
