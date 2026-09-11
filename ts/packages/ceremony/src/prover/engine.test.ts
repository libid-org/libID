import { afterEach, expect, it, vi } from 'vitest'
import { ProofEngine } from './engine.js'

vi.mock('../assets.js', () => ({ resolve: () => 'https://ccdp.test/asset' }))
vi.mock('./bb/assets.js', () => ({ abi: {}, acvm: {}, bbWasm: {}, crs: [{}] }))
afterEach(() => vi.unstubAllGlobals())

function engine() {
  let receive!: (event: { data: unknown }) => void
  const postMessage = vi.fn(),
    terminate = vi.fn()
  vi.stubGlobal('location', { href: 'https://ccdp.test/prover' })
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = postMessage
      terminate = terminate
      addEventListener(type: string, listener: typeof receive) {
        if (type === 'message') receive = listener
      }
    },
  )
  const events: { code: string; status: string }[] = []
  const instance = new ProofEngine({
    circuitUrl: 'https://ccdp.test/circuit',
    verificationKeyUrl: 'https://ccdp.test/vk',
    onProgress: (step) => events.push(step),
  })
  receive({ data: { type: 'engine-booted' } })
  return { instance, postMessage, terminate, events, send: (data: unknown) => receive({ data }) }
}
it('cancels an early witness, terminates the worker and ignores late delivery [LIBID-PROVER-014]', async () => {
  const e = engine()
  const controller = new AbortController()
  const result = e.instance.prove({ fixture: 1 }, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ code: 'proof' })
  e.send({ type: 'engine-span', code: 'proof-backend-initialization', status: 'started' })
  expect(e.postMessage).toHaveBeenCalledTimes(1)
  e.send({ type: 'engine-ready' })
  await vi.waitFor(() =>
    expect(e.postMessage).toHaveBeenCalledWith({ type: 'engine-prove', inputs: { fixture: 1 } }),
  )
  e.send({ type: 'engine-span', code: 'witness', status: 'started' })
  controller.abort()
  await rejected
  expect(e.terminate).toHaveBeenCalledOnce()
  expect(e.events.filter((event) => event.status === 'failed').map((event) => event.code)).toEqual([
    'proof-backend-initialization',
    'witness',
  ])
  const count = e.events.length
  e.send({ type: 'engine-span', code: 'witness', status: 'completed' })
  e.send({ type: 'engine-result', result: {} })
  e.instance.destroy()
  expect(e.events).toHaveLength(count)
  expect(e.terminate).toHaveBeenCalledOnce()
})
it('initialization failure releases waiting inputs without dispatching them [LIBID-PROVER-014]', async () => {
  const e = engine()
  const result = e.instance.prove({ fixture: 1 })
  const rejected = expect(result).rejects.toMatchObject({ code: 'proof' })
  e.send({ type: 'engine-error', error: 'Proof engine failed' })
  await rejected
  e.send({ type: 'engine-ready' })
  expect(e.postMessage).toHaveBeenCalledTimes(1)
  expect(e.terminate).toHaveBeenCalledOnce()
})
