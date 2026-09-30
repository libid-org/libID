import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { posted, stubWorkerScope } from '../testing/workers.js'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  initialize: vi.fn(),
  acvm: vi.fn(),
  abi: vi.fn(),
  execute: vi.fn(),
  prove: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@noir-lang/acvm_js', () => ({ default: mocks.acvm }))

vi.mock('@noir-lang/noirc_abi', () => ({ default: mocks.abi }))

vi.mock('@noir-lang/noir_js', () => ({
  Noir: class {
    execute = mocks.execute
  },
}))

vi.mock('@aztec/bb.js', () => ({
  BackendType: { Wasm: 'Wasm' },
  Barretenberg: { new: mocks.create },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
})

const preload = {
  type: 'preload',
  circuitUrl: 'https://ccdp.test/circuit.json',
  verificationKeyUrl: 'https://ccdp.test/vk',
  threads: 4,
  acvmUrl: '/acvm.wasm',
  abiUrl: '/abi.wasm',
  wasmPath: '/bb.wasm',
  crsPath: 'https://crs.test/',
}

const witness = () => ({ witness: gzipSync(Uint8Array.of(4, 5, 6)) })

/**
 * Boot the proof worker and deliver its preload. `runtime` is what bb logs about its thread pool
 * (nothing when null); `isolated` is the scope's cross-origin isolation.
 */
async function worker(
  key: Response | Promise<Response> = new Response(Uint8Array.of(11, 12)),
  { isolated = true, runtime = 'threads: 4; shared memory: true' as string | null } = {},
) {
  const request = vi.fn(async (url: string) =>
    url.endsWith('/vk')
      ? key
      : new Response(
          JSON.stringify({
            bytecode: gzipSync(Uint8Array.of(1, 2, 3)).toString('base64'),
          }),
        ),
  )
  const scope = stubWorkerScope({ crossOriginIsolated: isolated })
  vi.stubGlobal('fetch', request)
  mocks.create.mockImplementation(async ({ logger }) => {
    await mocks.initialize()
    if (runtime !== null) logger(runtime)
    return { circuitProve: mocks.prove, destroy: mocks.destroy }
  })
  mocks.execute.mockResolvedValue(witness())
  mocks.destroy.mockResolvedValue(undefined)
  mocks.prove.mockResolvedValue({
    proof: [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)],
    publicInputs: [new Uint8Array(32), new Uint8Array(32).fill(255)],
  })
  await import('./engine.worker.js')
  scope.deliver(preload)
  const { postMessage } = scope
  return {
    send: scope.deliver,
    prove: (inputs: Record<string, unknown>) => scope.deliver({ type: 'prove', inputs }),
    request,
    postMessage,
    has: (type: string) => posted(postMessage, type),
    /** Whether the worker has reported `event` finished. */
    finished: (event: string) =>
      postMessage.mock.calls.some(
        ([m]) => m.event?.event === event && m.event?.phase === 'finished',
      ),
    errors: () => postMessage.mock.calls.filter(([m]) => m.type === 'error').map(([m]) => m),
  }
}

it('uses the released VK with exact ZK Keccak settings and preserves proof encoding [LIBID-PROVER-001]', async () => {
  const w = await worker()
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  w.prove({ fixture: 1 })
  await expect.poll(() => w.has('result')).toBe(true)
  expect(w.request).toHaveBeenCalledWith('https://ccdp.test/vk', {
    credentials: 'same-origin',
    redirect: 'error',
  })
  expect(mocks.prove).toHaveBeenCalledExactlyOnceWith({
    circuit: {
      name: 'circuit',
      bytecode: Uint8Array.of(1, 2, 3),
      verificationKey: Uint8Array.of(11, 12),
    },
    witness: Uint8Array.of(4, 5, 6),
    settings: {
      ipaAccumulation: false,
      oracleHashType: 'keccak',
      disableZk: false,
      optimizedSolidityVerifier: false,
    },
  })
  expect(w.postMessage.mock.calls.find(([m]) => m.type === 'result')![0].result).toEqual({
    proof: Uint8Array.from([...new Uint8Array(32).fill(7), ...new Uint8Array(32).fill(8)]),
    publicInputs: [`0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`],
    runtime: { effectiveThreads: 4, sharedMemory: true },
  })
  expect(mocks.destroy).toHaveBeenCalledOnce()
})

it('delivers a finished proof even when releasing the backend fails', async () => {
  const w = await worker()
  mocks.destroy.mockRejectedValue(new Error('destroy failed'))
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  w.prove({ fixture: 1 })
  await expect.poll(() => w.has('result')).toBe(true)
  expect(w.errors()).toEqual([])
})

it.each(['missing', 'empty'])(
  'fails for a %s VK without falling back to recomputation [LIBID-PROVER-001]',
  async (kind) => {
    const w = await worker(new Response(null, { status: kind === 'missing' ? 404 : 200 }))
    await expect.poll(() => w.has('error')).toBe(true)
    expect(w.has('witness-ready')).toBe(false)
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.prove).not.toHaveBeenCalled()
  },
)

it('preserves cleanup when bb rejects the supplied key [LIBID-PROVER-001]', async () => {
  const w = await worker()
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  mocks.prove.mockRejectedValueOnce(new Error('Invalid verification key'))
  w.prove({})
  await expect.poll(() => w.has('error')).toBe(true)
  expect(w.has('result')).toBe(false)
  expect(mocks.prove).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
})

it.each(['backend', 'resources'])(
  'starts all preload branches before %s finishes [LIBID-PROVER-012]',
  async (first) => {
    const backend = Promise.withResolvers<void>(),
      acvm = Promise.withResolvers<void>(),
      abi = Promise.withResolvers<void>(),
      key = Promise.withResolvers<Response>()
    mocks.initialize.mockReturnValueOnce(backend.promise)
    mocks.acvm.mockReturnValueOnce(acvm.promise)
    mocks.abi.mockReturnValueOnce(abi.promise)
    const w = await worker(key.promise)
    // Each branch starts with its explicit emitted location.
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: 'Wasm',
        threads: 4,
        srsSize: 2 ** 18,
        wasmPath: '/bb.wasm',
        crsPath: 'https://crs.test/',
      }),
    )
    expect(mocks.acvm).toHaveBeenCalledExactlyOnceWith({ module_or_path: '/acvm.wasm' })
    expect(mocks.abi).toHaveBeenCalledExactlyOnceWith({ module_or_path: '/abi.wasm' })
    expect(w.request).toHaveBeenCalledTimes(2)
    expect(w.has('witness-ready')).toBe(false)
    const resources = () => {
      acvm.resolve()
      abi.resolve()
      key.resolve(new Response(Uint8Array.of(11, 12)))
    }
    if (first === 'backend') {
      backend.resolve()
      await expect.poll(() => w.finished('proof-backend-initialization')).toBe(true)
      expect(w.has('witness-ready')).toBe(false)
      resources()
    } else {
      resources()
      await expect.poll(() => w.finished('proof-circuit-load')).toBe(true)
      await expect.poll(() => w.has('witness-ready')).toBe(true)
      backend.resolve()
    }
    await expect.poll(() => w.has('witness-ready')).toBe(true)
    expect(mocks.destroy).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  },
)

it.each(['cross-origin isolation', 'shared memory'])(
  'fails without %s before starting any preload branch [CSP-016] [LIBID-PROVER-015] [LIBID-OAUTH-010]',
  async (missing) => {
    if (missing === 'shared memory') vi.stubGlobal('SharedArrayBuffer', undefined)
    const w = await worker(undefined, { isolated: missing !== 'cross-origin isolation' })
    await expect.poll(() => w.has('error')).toBe(true)
    expect(w.errors()).toEqual([
      {
        type: 'error',
        event: 'zk-proof-preparation',
        message: 'proof worker requires cross-origin isolation',
      },
    ])
    expect(mocks.create).not.toHaveBeenCalled()
    expect(w.request).not.toHaveBeenCalled()
    expect(mocks.acvm).not.toHaveBeenCalled()
  },
)

it.each([
  ['one thread', 'threads: 1; shared memory: true'],
  ['no shared memory', 'threads: 4; shared memory: false'],
  ['no thread pool', null],
])(
  'fails and destroys a backend reporting %s instead of multithreaded execution [LIBID-PROVER-015] [LIBID-OAUTH-010]',
  async (_, runtime) => {
    const w = await worker(undefined, { runtime })
    await expect.poll(() => w.has('error')).toBe(true)
    expect(w.errors()).toEqual([
      {
        type: 'error',
        event: 'proof-backend-initialization',
        message: 'Multithreaded backend unavailable',
      },
    ])
    await expect.poll(() => w.finished('proof-circuit-load')).toBe(true)
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(w.has('backend-ready')).toBe(false)
    expect(mocks.prove).not.toHaveBeenCalled()
  },
)

it('a duplicate preload fails once and releases the started backend', async () => {
  const w = await worker()
  w.send(preload)
  await expect.poll(() => w.has('error')).toBe(true)
  expect(w.errors()).toEqual([
    { type: 'error', event: 'zk-proof-preparation', message: 'Duplicate engine initialization' },
  ])
  await expect
    .poll(() => w.finished('proof-circuit-load') && w.finished('proof-wasm-load'))
    .toBe(true)
  await expect.poll(() => mocks.destroy.mock.calls.length).toBe(1)
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(w.has('witness-ready')).toBe(false)
  expect(w.has('backend-ready')).toBe(false)
})

it.each(['circuit', 'wasm'])(
  'fails promptly on %s loading and releases a late backend [LIBID-PROVER-014]',
  async (failure) => {
    const backend = Promise.withResolvers<void>()
    mocks.initialize.mockReturnValueOnce(backend.promise)
    if (failure === 'wasm') mocks.acvm.mockRejectedValueOnce(new Error('WASM load failed'))
    const w = await worker(
      failure === 'circuit'
        ? new Response(null, { status: 404 })
        : new Response(Uint8Array.of(11, 12)),
    )
    await expect.poll(() => w.has('error')).toBe(true)
    expect(mocks.destroy).not.toHaveBeenCalled()
    backend.resolve()
    await expect.poll(() => mocks.destroy.mock.calls.length).toBe(1)
    expect(w.has('witness-ready')).toBe(false)
    expect(mocks.prove).not.toHaveBeenCalled()
  },
)

it('releases an initialized backend when Noir loading fails [LIBID-PROVER-014]', async () => {
  const acvm = Promise.withResolvers<void>()
  mocks.acvm.mockReturnValueOnce(acvm.promise)
  const w = await worker()
  await expect.poll(() => w.finished('proof-backend-initialization')).toBe(true)
  acvm.reject(new Error('WASM load failed'))
  await expect.poll(() => w.has('error')).toBe(true)
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(w.has('witness-ready')).toBe(false)
})

it('backend failure does not wait for pending resource loads [LIBID-PROVER-014]', async () => {
  const key = Promise.withResolvers<Response>()
  mocks.initialize.mockRejectedValueOnce(new Error('Backend unavailable'))
  const w = await worker(key.promise)
  await expect.poll(() => w.has('error')).toBe(true)
  expect(mocks.destroy).not.toHaveBeenCalled()
  key.resolve(new Response(Uint8Array.of(11, 12)))
  await expect.poll(() => w.finished('proof-circuit-load')).toBe(true)
  expect(w.has('witness-ready')).toBe(false)
  expect(mocks.prove).not.toHaveBeenCalled()
})

it.each(['witness', 'backend'])(
  'overlaps witness execution with backend initialization when %s finishes first [LIBID-PROVER-012]',
  async (first) => {
    const backend = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<{ witness: Uint8Array }>()
    mocks.initialize.mockReturnValueOnce(backend.promise)
    const w = await worker()
    mocks.execute.mockReturnValueOnce(pending.promise)
    await expect.poll(() => w.has('witness-ready')).toBe(true)
    w.prove({ fixture: 1 })
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ fixture: 1 })
    expect(mocks.prove).not.toHaveBeenCalled()
    const finishWitness = () => pending.resolve(witness())
    if (first === 'witness') finishWitness()
    else backend.resolve()
    await expect
      .poll(() => w.finished(first === 'witness' ? 'witness' : 'proof-backend-initialization'))
      .toBe(true)
    expect(mocks.prove).not.toHaveBeenCalled()
    if (first === 'witness') backend.resolve()
    else finishWitness()
    await expect.poll(() => w.has('result')).toBe(true)
    expect(mocks.prove).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  },
)

it('reports witness failure promptly and destroys a late backend once [LIBID-PROVER-014]', async () => {
  const backend = Promise.withResolvers<void>()
  mocks.initialize.mockReturnValueOnce(backend.promise)
  const w = await worker()
  mocks.execute.mockRejectedValueOnce(new Error('Witness failed'))
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  w.prove({})
  await expect.poll(() => w.has('error')).toBe(true)
  expect(mocks.destroy).not.toHaveBeenCalled()
  backend.resolve()
  await expect.poll(() => mocks.destroy.mock.calls.length).toBe(1)
  expect(mocks.prove).not.toHaveBeenCalled()
  expect(w.has('result')).toBe(false)
})

it('backend failure cannot wait for or revive a pending witness [LIBID-PROVER-014]', async () => {
  const backend = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<{ witness: Uint8Array }>()
  mocks.initialize.mockReturnValueOnce(backend.promise)
  const w = await worker()
  mocks.execute.mockReturnValueOnce(pending.promise)
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  w.prove({})
  backend.reject(new Error('Backend failed'))
  await expect.poll(() => w.has('error')).toBe(true)
  pending.resolve(witness())
  await expect.poll(() => w.finished('witness')).toBe(true)
  expect(w.errors()).toHaveLength(1)
  expect(mocks.prove).not.toHaveBeenCalled()
  expect(w.has('result')).toBe(false)
})

it('a duplicate request fails once and cannot deliver a late proof [LIBID-PROVER-014]', async () => {
  const proof = Promise.withResolvers<unknown>()
  const w = await worker()
  mocks.prove.mockReturnValueOnce(proof.promise)
  await expect.poll(() => w.has('witness-ready')).toBe(true)
  w.prove({})
  await expect.poll(() => mocks.prove.mock.calls.length).toBe(1)
  w.prove({})
  await expect.poll(() => w.has('error')).toBe(true)
  proof.resolve({ proof: [new Uint8Array(32)], publicInputs: [] })
  await expect.poll(() => w.finished('proof')).toBe(true)
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(w.errors()).toHaveLength(1)
  expect(w.has('result')).toBe(false)
})
