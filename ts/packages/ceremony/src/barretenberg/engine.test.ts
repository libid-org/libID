import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OperationEvent } from '../events.js'
import { type FakeWorker, stubWorkers } from '../testing/workers.js'
import { ProofEngine, type ProofEngineOptions } from './engine.js'

const { assetUrl } = vi.hoisted(() => ({ assetUrl: vi.fn() }))

vi.mock('../assets/index.js', () => ({ assetUrl }))

vi.mock('./barretenberg.assets.js', () => ({
  abi: { path: 'noir/abi.wasm' },
  acvm: { path: 'noir/acvm.wasm' },
  bbWasm: { path: 'bb/barretenberg-threads.wasm' },
  crs: [{ path: 'crs/g1.dat' }],
}))

let workers: FakeWorker[]

beforeEach(() => {
  assetUrl.mockImplementation(({ path }) => `https://ccdp.test/assets/${path}`)
  vi.stubGlobal('location', { href: 'https://ccdp.test/prover' })
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  workers = stubWorkers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

const options = {
  circuitUrl: 'https://ccdp.test/circuit',
  verificationKeyUrl: 'https://ccdp.test/vk',
}

/** An engine whose worker has booted and received its preload. */
function engine(extra: Partial<ProofEngineOptions> = {}) {
  const events: OperationEvent[] = []
  const instance = new ProofEngine({ ...options, emit: (event) => events.push(event), ...extra })
  const worker = workers.at(-1)!
  worker.reply({ type: 'booted', timestamp: 1 })
  return {
    instance,
    postMessage: worker.postMessage,
    terminate: worker.terminate,
    events,
    crash: (fields: Parameters<FakeWorker['crash']>[0]) => worker.crash(fields),
    send: (data: unknown) => worker.reply(data),
  }
}

it('posts one preload after boot with resolved resource URLs and capped threads [LIBID-PROVER-015]', () => {
  const e = engine({ circuitUrl: 'circuits/bearer_link.json', threads: 8 })
  e.send({ type: 'booted', timestamp: 2 })
  expect(e.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'preload',
    circuitUrl: 'https://ccdp.test/circuits/bearer_link.json',
    verificationKeyUrl: 'https://ccdp.test/vk',
    threads: 4,
    acvmUrl: 'https://ccdp.test/assets/noir/acvm.wasm',
    abiUrl: 'https://ccdp.test/assets/noir/abi.wasm',
    // bb.js derives the threaded file name itself; the CRS base is its directory.
    wasmPath: 'https://ccdp.test/assets/bb/barretenberg.wasm',
    crsPath: 'https://ccdp.test/assets/crs/',
  })
  engine({ threads: 2 })
  expect(workers[1].postMessage.mock.calls[0][0]).toMatchObject({ type: 'preload', threads: 2 })
})

it.each([
  'javascript:alert(1)',
  'data:application/json,{}',
  'https://user@ccdp.test/circuit',
  'https://:secret@ccdp.test/circuit',
  'https://ccdp.test/circuit#fragment',
])('rejects the circuit resource URL %s before starting a worker', (url) => {
  expect(() => new ProofEngine({ ...options, circuitUrl: url })).toThrow(
    'invalid circuit resource URL',
  )
  expect(() => new ProofEngine({ ...options, verificationKeyUrl: url })).toThrow(
    'invalid circuit resource URL',
  )
  expect(workers).toHaveLength(0)
})

it('cancels an early witness, terminates the worker and ignores late delivery [LIBID-PROVER-014]', async () => {
  const e = engine()
  const controller = new AbortController()
  const result = e.instance.prove({ fixture: 1 }, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ event: 'zk-proof-generation' })
  e.send({
    type: 'event',
    event: { event: 'proof-backend-initialization', phase: 'started', timestamp: 2 },
  })
  expect(e.postMessage).toHaveBeenCalledTimes(1)
  e.send({ type: 'witness-ready' })
  await vi.waitFor(() =>
    expect(e.postMessage).toHaveBeenCalledWith({ type: 'prove', inputs: { fixture: 1 } }),
  )
  e.send({ type: 'event', event: { event: 'witness', phase: 'started', timestamp: 3 } })
  controller.abort()
  await rejected
  expect(e.terminate).toHaveBeenCalledOnce()
  expect(
    e.events.filter((event) => event.phase === 'finished').map((event) => event.event),
  ).toEqual(['proof-worker-bootstrap'])
  const count = e.events.length
  e.send({ type: 'event', event: { event: 'witness', phase: 'finished', timestamp: 4 } })
  e.send({ type: 'result', result: {} })
  e.instance.destroy()
  expect(e.events).toHaveLength(count)
  expect(e.terminate).toHaveBeenCalledOnce()
})

it('rejects an already-aborted proof without dispatching its inputs', async () => {
  const e = engine()
  const reason = new Error('Ceremony closed')
  await expect(e.instance.prove({ fixture: 1 }, AbortSignal.abort(reason))).rejects.toMatchObject({
    event: 'zk-proof-generation',
    message: 'Ceremony closed',
  })
  e.send({ type: 'witness-ready' })
  await Promise.resolve()
  expect(e.postMessage).toHaveBeenCalledTimes(1)
  expect(e.terminate).toHaveBeenCalledOnce()
})

it('delivers one proof, rejects a second request and ignores messages after settlement', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  await expect(e.instance.prove({ fixture: 2 })).rejects.toThrow('proof engine is single-use')
  e.send({ type: 'witness-ready' })
  await vi.waitFor(() =>
    expect(e.postMessage).toHaveBeenLastCalledWith({ type: 'prove', inputs: { fixture: 1 } }),
  )
  const proof = {
    proof: new Uint8Array(64),
    publicInputs: [],
    runtime: { effectiveThreads: 4, sharedMemory: true },
  }
  e.send({ type: 'result', result: proof })
  await expect(result).resolves.toBe(proof)
  expect(e.terminate).toHaveBeenCalledOnce()
  const count = e.events.length
  e.send({ type: 'event', event: { event: 'proof', phase: 'finished', timestamp: 5 } })
  e.send({ type: 'error', event: 'zk-proof-generation', message: 'Late failure' })
  e.instance.destroy()
  expect(e.events).toHaveLength(count)
  expect(e.terminate).toHaveBeenCalledOnce()
  expect(e.postMessage).toHaveBeenCalledTimes(2)
})

it('initialization failure releases waiting inputs without dispatching them [LIBID-PROVER-014]', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  const rejected = expect(result).rejects.toMatchObject({ event: 'zk-proof-generation' })
  e.send({ type: 'error', event: 'zk-proof-generation', message: 'Proof engine failed' })
  await rejected
  e.send({ type: 'witness-ready' })
  expect(e.postMessage).toHaveBeenCalledTimes(1)
  expect(e.terminate).toHaveBeenCalledOnce()
})

it.each(['asset resolution', 'destroy'])(
  'attributes failure before inputs to preparation: %s',
  async (failure) => {
    if (failure === 'asset resolution')
      assetUrl.mockImplementation(() => {
        throw new Error('Missing built asset')
      })
    const instance = new ProofEngine(options)
    if (failure === 'destroy') instance.destroy()
    await expect(instance.prove({ fixture: 1 })).rejects.toMatchObject({
      event: 'zk-proof-preparation',
      message: failure === 'destroy' ? 'proof engine destroyed' : 'Missing built asset',
    })
    // A missing asset never starts the worker; destroying retires the started one.
    expect(workers).toHaveLength(failure === 'destroy' ? 1 : 0)
    if (failure === 'destroy') expect(workers[0].terminate).toHaveBeenCalledOnce()
  },
)

it('fails the proof when its inputs cannot be posted to the worker', async () => {
  const e = engine()
  e.postMessage.mockImplementationOnce(() => {
    throw new DOMException('Inputs could not be cloned', 'DataCloneError')
  })
  const result = e.instance.prove({ fixture: 1 })
  e.send({ type: 'witness-ready' })
  await expect(result).rejects.toMatchObject({
    event: 'zk-proof-generation',
    message: 'Inputs could not be cloned',
  })
  expect(e.terminate).toHaveBeenCalledOnce()
})

it.each([
  ['an unknown', { type: 'unknown' }, 'unexpected proof worker message'],
  ['a malformed', null, "Cannot read properties of null (reading 'type')"],
])('fails the proof on %s worker message', async (_, message, reason) => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  e.send(message)
  await expect(result).rejects.toMatchObject({ event: 'zk-proof-generation', message: reason })
  expect(e.terminate).toHaveBeenCalledOnce()
})

it('preparation finishes only once both backend and inputs are ready, without blocking witness dispatch', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 }).catch(() => {})
  e.send({ type: 'witness-ready' })
  await vi.waitFor(() =>
    expect(e.postMessage).toHaveBeenCalledWith({ type: 'prove', inputs: { fixture: 1 } }),
  )
  expect(
    e.events.filter((x) => x.event === 'zk-proof-preparation' && x.phase === 'finished'),
  ).toHaveLength(0)
  const timestamp = performance.timeOrigin + performance.now() + 1
  e.send({ type: 'backend-ready', timestamp })
  expect(
    e.events.filter((x) => x.event === 'zk-proof-preparation' && x.phase === 'finished'),
  ).toEqual([{ event: 'zk-proof-preparation', phase: 'finished', timestamp }])
  e.instance.destroy()
  await result
})

it('reports an uncaught worker error without its source location', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  e.crash({
    message: 'Uncaught Error: bb',
    filename: 'https://ccdp.test/engine.worker.js',
    lineno: 7,
  })
  await expect(result).rejects.toMatchObject({
    event: 'zk-proof-generation',
    message: 'Uncaught Error: bb',
  })
  expect(e.terminate).toHaveBeenCalledOnce()
})

it('reports a generic failure for an uncaught worker error without a message', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  e.crash({ message: '' })
  await expect(result).rejects.toMatchObject({
    event: 'zk-proof-generation',
    message: 'proof worker failed',
  })
})
