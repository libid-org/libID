import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'

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
vi.mock('./bb/assets.js', () => ({ SRS_SIZE: 2 ** 18 }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
})
async function worker(key: Response | Promise<Response> = new Response(Uint8Array.of(11, 12))) {
  let receive!: (event: { data: unknown }) => void
  const postMessage = vi.fn()
  const request = vi.fn(async (url: string) =>
    url.endsWith('/vk')
      ? key
      : new Response(
          JSON.stringify({
            bytecode: gzipSync(Uint8Array.of(1, 2, 3)).toString('base64'),
          }),
        ),
  )
  vi.stubGlobal('self', {
    crossOriginIsolated: true,
    postMessage,
    addEventListener: (_: string, callback: typeof receive) => {
      receive = callback
    },
  })
  vi.stubGlobal('fetch', request)
  mocks.create.mockImplementation(async ({ logger }) => {
    await mocks.initialize()
    logger('threads: 4; shared memory: true')
    return { circuitProve: mocks.prove, destroy: mocks.destroy }
  })
  mocks.execute.mockResolvedValue({ witness: gzipSync(Uint8Array.of(4, 5, 6)) })
  mocks.destroy.mockResolvedValue(undefined)
  mocks.prove.mockResolvedValue({
    proof: [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)],
    publicInputs: [new Uint8Array(32), new Uint8Array(32).fill(255)],
  })
  await import('./engine.worker.js')
  receive({
    data: {
      type: 'engine-preload',
      circuitUrl: 'https://ccdp.test/circuit.json',
      verificationKeyUrl: 'https://ccdp.test/vk',
      threads: 4,
      acvmUrl: '/acvm.wasm',
      abiUrl: '/abi.wasm',
      wasmPath: '/bb.wasm.gz',
      crsPath: 'https://crs.test/',
    },
  })
  return {
    receive,
    request,
    postMessage,
    has: (type: string) => postMessage.mock.calls.some(([m]) => m.type === type),
  }
}
it('uses the released VK with exact ZK Keccak settings and preserves proof encoding [LIBID-PROVER-001]', async () => {
  const w = await worker()
  await expect.poll(() => w.has('engine-ready')).toBe(true)
  w.receive({ data: { type: 'engine-prove', inputs: { fixture: 1 } } })
  await expect.poll(() => w.has('engine-result')).toBe(true)
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
  expect(w.postMessage.mock.calls.find(([m]) => m.type === 'engine-result')![0].result).toEqual({
    proof: Uint8Array.from([...new Uint8Array(32).fill(7), ...new Uint8Array(32).fill(8)]),
    publicInputs: [`0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`],
    runtime: { effectiveThreads: 4, sharedMemory: true },
  })
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
it.each(['missing', 'empty'])(
  'fails for a %s VK without falling back to recomputation [LIBID-PROVER-001]',
  async (kind) => {
    const w = await worker(new Response(null, { status: kind === 'missing' ? 404 : 200 }))
    await expect.poll(() => w.has('engine-error')).toBe(true)
    expect(w.has('engine-ready')).toBe(false)
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.prove).not.toHaveBeenCalled()
  },
)
it('preserves cleanup when bb rejects the supplied key [LIBID-PROVER-001]', async () => {
  const w = await worker()
  await expect.poll(() => w.has('engine-ready')).toBe(true)
  mocks.prove.mockRejectedValueOnce(new Error('Invalid verification key'))
  w.receive({ data: { type: 'engine-prove', inputs: {} } })
  await expect.poll(() => w.has('engine-error')).toBe(true)
  expect(w.has('engine-result')).toBe(false)
  expect(mocks.prove).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
it.each(['backend', 'resources'])(
  'starts all preload branches before %s finishes [LIBID-PROVER-012]',
  async (first) => {
    const backend = deferred<void>(),
      acvm = deferred<void>(),
      abi = deferred<void>(),
      key = deferred<Response>()
    mocks.initialize.mockReturnValueOnce(backend.promise)
    mocks.acvm.mockReturnValueOnce(acvm.promise)
    mocks.abi.mockReturnValueOnce(abi.promise)
    const w = await worker(key.promise)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.acvm).toHaveBeenCalledOnce()
    expect(mocks.abi).toHaveBeenCalledOnce()
    expect(w.request).toHaveBeenCalledTimes(2)
    expect(w.has('engine-ready')).toBe(false)
    const resources = () => {
      acvm.resolve()
      abi.resolve()
      key.resolve(new Response(Uint8Array.of(11, 12)))
    }
    if (first === 'backend') {
      backend.resolve()
      await expect
        .poll(() =>
          w.postMessage.mock.calls.some(
            ([m]) => m.code === 'proof-backend-initialization' && m.status === 'completed',
          ),
        )
        .toBe(true)
      expect(w.has('engine-ready')).toBe(false)
      resources()
    } else {
      resources()
      await expect
        .poll(() =>
          w.postMessage.mock.calls.some(
            ([m]) => m.code === 'proof-circuit-load' && m.status === 'completed',
          ),
        )
        .toBe(true)
      expect(w.has('engine-ready')).toBe(false)
      backend.resolve()
    }
    await expect.poll(() => w.has('engine-ready')).toBe(true)
    expect(mocks.destroy).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  },
)
it.each(['circuit', 'wasm'])(
  'fails promptly on %s loading and releases a late backend [LIBID-PROVER-014]',
  async (failure) => {
    const backend = deferred<void>()
    mocks.initialize.mockReturnValueOnce(backend.promise)
    if (failure === 'wasm') mocks.acvm.mockRejectedValueOnce(new Error('WASM load failed'))
    const w = await worker(
      failure === 'circuit'
        ? new Response(null, { status: 404 })
        : new Response(Uint8Array.of(11, 12)),
    )
    await expect.poll(() => w.has('engine-error')).toBe(true)
    expect(mocks.destroy).not.toHaveBeenCalled()
    backend.resolve()
    await expect.poll(() => mocks.destroy.mock.calls.length).toBe(1)
    expect(w.has('engine-ready')).toBe(false)
    expect(mocks.prove).not.toHaveBeenCalled()
  },
)
it('releases an initialized backend when Noir loading fails [LIBID-PROVER-014]', async () => {
  const acvm = deferred<void>()
  mocks.acvm.mockReturnValueOnce(acvm.promise)
  const w = await worker()
  await expect
    .poll(() =>
      w.postMessage.mock.calls.some(
        ([m]) => m.code === 'proof-backend-initialization' && m.status === 'completed',
      ),
    )
    .toBe(true)
  acvm.reject(new Error('WASM load failed'))
  await expect.poll(() => w.has('engine-error')).toBe(true)
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(w.has('engine-ready')).toBe(false)
})
it('backend failure does not wait for pending resource loads [LIBID-PROVER-014]', async () => {
  const key = deferred<Response>()
  mocks.initialize.mockRejectedValueOnce(new Error('Backend unavailable'))
  const w = await worker(key.promise)
  await expect.poll(() => w.has('engine-error')).toBe(true)
  expect(mocks.destroy).not.toHaveBeenCalled()
  key.resolve(new Response(Uint8Array.of(11, 12)))
  await expect
    .poll(() =>
      w.postMessage.mock.calls.some(
        ([m]) => m.code === 'proof-circuit-load' && m.status === 'completed',
      ),
    )
    .toBe(true)
  expect(w.has('engine-ready')).toBe(false)
  expect(mocks.prove).not.toHaveBeenCalled()
})
