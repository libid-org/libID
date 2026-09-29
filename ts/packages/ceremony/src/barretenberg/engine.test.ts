import { afterEach, expect, it, vi } from 'vitest'
import { ProofEngine } from './engine.js'

vi.mock('../assets/index.js', () => ({ assetUrl: () => 'https://ccdp.test/asset' }))

vi.mock('./barretenberg.assets.js', () => ({ abi: {}, acvm: {}, bbWasm: {}, crs: [{}] }))

afterEach(() => vi.unstubAllGlobals())

function engine() {
  let receive!: (event: { data: unknown }) => void
  let crash!: (event: Partial<ErrorEvent>) => void
  const postMessage = vi.fn(),
    terminate = vi.fn()
  vi.stubGlobal('location', { href: 'https://ccdp.test/prover' })
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = postMessage
      terminate = terminate

      addEventListener(type: string, listener: typeof receive & typeof crash) {
        if (type === 'message') receive = listener
        else crash = listener
      }
    },
  )
  const events: import('../events.js').OperationEvent[] = []
  const instance = new ProofEngine({
    circuitUrl: 'https://ccdp.test/circuit',
    verificationKeyUrl: 'https://ccdp.test/vk',
    emit: (event) => events.push(event),
  })
  receive({ data: { type: 'booted', timestamp: 1 } })
  return {
    instance,
    postMessage,
    terminate,
    events,
    crash,
    send: (data: unknown) => receive({ data }),
  }
}

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
