import initACVM from '@noir-lang/acvm_js'
import { Noir } from '@noir-lang/noir_js'
import initAbi from '@noir-lang/noirc_abi'
import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js'
import type { RawProof } from './engine.js'
import { SRS_SIZE } from './bb/assets.js'

type Circuit = ConstructorParameters<typeof Noir>[0]
type Api = Awaited<ReturnType<typeof Barretenberg.new>>
type Backend = InstanceType<typeof UltraHonkBackend>

type Preload = {
  type: 'engine-preload'
  circuitUrl: string
  threads: number
  acvmUrl: string
  abiUrl: string
  wasmPath: string
  crsPath: string
}
type Prove = { type: 'engine-prove'; inputs: Record<string, unknown> }

let runtime: { effectiveThreads: number; sharedMemory: boolean } | undefined
let state: 'new' | 'loading' | 'ready' | 'proving' | 'done' = 'new'
let ready: { noir: Noir; api: Api; backend: Backend } | null = null

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

async function preload(message: Preload): Promise<void> {
  if (state !== 'new') throw new Error('Duplicate engine initialization')
  state = 'loading'
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('proof worker requires cross-origin isolation')
  }
  const [circuit] = await Promise.all([
    span('proof-circuit-load', async () => {
      const response = await fetch(message.circuitUrl, {
        credentials: 'same-origin',
        redirect: 'error',
      })
      if (!response.ok) throw new Error('Circuit request failed')
      return (await response.json()) as Circuit
    }),
    span('proof-wasm-load', async () => {
      await Promise.all([
        initACVM({ module_or_path: message.acvmUrl }),
        initAbi({ module_or_path: message.abiUrl }),
      ])
    }),
  ])
  ready = await span('proof-backend-initialization', async () => {
    const api = await Barretenberg.new({
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
    return {
      noir: new Noir(circuit),
      api,
      backend: new UltraHonkBackend(circuit.bytecode, api),
    }
  })
  state = 'ready'
  send({ type: 'engine-ready' })
}

async function prove(message: Prove): Promise<void> {
  if (!ready || state !== 'ready') throw new Error('proof engine is not ready')
  state = 'proving'
  const { noir, api, backend } = ready
  try {
    const { witness } = await span('witness', () =>
      noir.execute(message.inputs as Parameters<typeof noir.execute>[0]),
    )
    const generated = await span('proof', () =>
      backend.generateProof(witness, { verifierTarget: 'evm' }),
    )
    await span('proof-backend-destroy', () => api.destroy())
    ready = null
    const result: RawProof = {
      proof:
        generated.proof instanceof Uint8Array
          ? generated.proof
          : new Uint8Array(generated.proof as number[]),
      publicInputs: generated.publicInputs,
      runtime: runtime!,
    }
    state = 'done'
    send({ type: 'engine-result', result })
  } catch (error) {
    await api.destroy().catch(() => undefined)
    ready = null
    throw error
  }
}

send({ type: 'engine-booted' })
self.addEventListener('message', (event: MessageEvent<Preload | Prove>) => {
  const work = event.data.type === 'engine-preload' ? preload(event.data) : prove(event.data)
  void work.catch((_error: unknown) => {
    send({ type: 'engine-error', error: 'Proof engine failed' })
  })
})
