import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  prove: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('@noir-lang/acvm_js', () => ({ default: async () => {} }))
vi.mock('@noir-lang/noirc_abi', () => ({ default: async () => {} }))
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
async function worker(key = new Response(Uint8Array.of(11, 12))) {
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
    expect(mocks.create).not.toHaveBeenCalled()
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
