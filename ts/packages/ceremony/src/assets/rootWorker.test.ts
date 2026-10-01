import { beforeEach, expect, it, vi } from 'vitest'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('./cache.js', async (original) => ({
  ...(await original<typeof import('./cache.js')>()),
  AssetCache: class {
    load = load
  },
}))

vi.mock('@libid/popup/worker', () => ({ installPortKeeper: vi.fn() }))

vi.mock('virtual:ceremony-assets', () => ({
  requestsByProfile: { 'google/1': [{ url: '/asset' }] },
  allowedRequests: [{ url: '/asset' }, { url: '/g1.dat', range: 'bytes=0-1' }],
}))

import { startRootWorker } from './rootWorker.js'

beforeEach(() => {
  load.mockReset()
})

const PREFETCH = 'https://ccdp.example/ccdp/v1/prefetch'

/** Start the worker on a scope double; `dispatch(type, event)` runs its listener for `type`. */
function start(scope: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: unknown) => void>()
  startRootWorker({
    location: { origin: 'https://ccdp.example' },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    ...scope,
  } as unknown as ServiceWorkerGlobalScope)
  return (type: string, event: unknown) => handlers.get(type)!(event)
}

const port = () => ({ postMessage: vi.fn(), close: vi.fn() })

it.each(['fetch', 'message', 'failed-prefetch'])(
  'keeps %s lifetime tied to persistence after response delivery [CSP-017]',
  async (type) => {
    const complete = Promise.withResolvers<void>()
    const response =
      type === 'failed-prefetch'
        ? Promise.reject(new Error('asset unavailable'))
        : Promise.resolve(new Response(new Uint8Array([1])))
    load.mockReturnValue({ dispatched: Promise.resolve(), response, complete: complete.promise })
    const dispatch = start()
    const waits: Promise<unknown>[] = []
    const respondWith = vi.fn()
    dispatch(type === 'fetch' ? 'fetch' : 'message', {
      request: new Request('https://ccdp.example/asset'),
      respondWith,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      data: { type: 'ceremony-prefetch', profile: 'google/1' },
      ports: [port()],
      source: { url: PREFETCH },
    })
    expect(waits).toHaveLength(1)
    let settled = false
    void waits[0].then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    if (type === 'fetch') expect(respondWith).toHaveBeenCalledWith(response)
    complete.resolve()
    await waits[0]
    expect(settled).toBe(true)
  },
)

it('acknowledges prefetch dispatch on its port once every profile request is dispatched', async () => {
  const dispatched = Promise.withResolvers<void>()
  load.mockReturnValue({
    dispatched: dispatched.promise,
    response: Promise.resolve(new Response()),
    complete: Promise.resolve(),
  })
  const reply = port()
  const waits: Promise<unknown>[] = []
  start()('message', {
    data: { type: 'ceremony-prefetch', profile: 'google/1' },
    ports: [reply],
    source: { url: PREFETCH },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  })
  // Profile paths are fetched at the worker's origin.
  expect(load).toHaveBeenCalledExactlyOnceWith({ url: 'https://ccdp.example/asset' })
  await Promise.resolve()
  expect(reply.postMessage).not.toHaveBeenCalled()
  dispatched.resolve()
  await waits[0]
  expect(reply.postMessage).toHaveBeenCalledExactlyOnceWith({ dispatched: true })
  expect(reply.close).toHaveBeenCalledOnce()
})

it('claims a same-origin client before acknowledging on its port', async () => {
  const claim = Promise.withResolvers<void>()
  const clients = { claim: vi.fn(() => claim.promise) }
  const reply = port()
  const waits: Promise<unknown>[] = []
  start({ clients })('message', {
    data: { type: 'ceremony-claim' },
    ports: [reply],
    source: { url: 'https://ccdp.example/ccdp/v1/prover' },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  })
  expect(clients.claim).toHaveBeenCalledOnce()
  expect(waits).toHaveLength(1)
  await Promise.resolve()
  expect(reply.postMessage).not.toHaveBeenCalled()
  claim.resolve()
  await waits[0]
  expect(reply.postMessage).toHaveBeenCalledExactlyOnceWith({ claimed: true })
  expect(reply.close).toHaveBeenCalledOnce()
})

it('activates without waiting and claims open clients', () => {
  const waits: unknown[] = []
  const skipWaiting = vi.fn(async () => {})
  const clients = { claim: vi.fn(async () => {}) }
  const dispatch = start({ skipWaiting, clients })
  const waitUntil = (p: unknown) => waits.push(p)
  dispatch('install', { waitUntil })
  expect(skipWaiting).toHaveBeenCalledOnce()
  dispatch('activate', { waitUntil })
  expect(clients.claim).toHaveBeenCalledOnce()
  expect(waits).toHaveLength(2)
})

it.each([
  ['a non-GET request', 'POST', 'https://ccdp.example/asset', {}],
  ['an unlisted URL', 'GET', 'https://ccdp.example/other', {}],
  ['a listed URL with another range', 'GET', 'https://ccdp.example/g1.dat', { Range: 'bytes=0-9' }],
  ['a ranged asset without its range', 'GET', 'https://ccdp.example/g1.dat', {}],
])('leaves %s to the network', (_, method, url, headers) => {
  const respondWith = vi.fn()
  const waitUntil = vi.fn()
  start()('fetch', { request: new Request(url, { method, headers }), respondWith, waitUntil })
  expect(respondWith).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it('serves an allowed range from the cache', () => {
  const response = Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 206 }))
  load.mockReturnValue({ response, complete: Promise.resolve() })
  const respondWith = vi.fn()
  start()('fetch', {
    request: new Request('https://ccdp.example/g1.dat', { headers: { Range: 'bytes=0-1' } }),
    respondWith,
    waitUntil: vi.fn(),
  })
  expect(load).toHaveBeenCalledExactlyOnceWith({
    url: 'https://ccdp.example/g1.dat',
    range: 'bytes=0-1',
  })
  expect(respondWith).toHaveBeenCalledWith(response)
})

it.each([
  [{ type: 'ceremony-claim' }, 'https://evil.example/page'],
  [{ type: 'ceremony-claim', extra: true }, 'https://ccdp.example/ccdp/v1/prover'],
  [{ type: 'ceremony-prefetch', profile: 'google/1' }, 'https://evil.example/page'],
])('closes the ports of an invalid ceremony request %j from %s without replying', (data, url) => {
  const claim = vi.fn(async () => {})
  const reply = port()
  const waitUntil = vi.fn()
  start({ clients: { claim } })('message', { data, ports: [reply], source: { url }, waitUntil })
  expect(reply.close).toHaveBeenCalledOnce()
  expect(reply.postMessage).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
  expect(claim).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it.each([
  ['a claim with two ports', { type: 'ceremony-claim' }, 2, PREFETCH],
  ['a prefetch without a port', { type: 'ceremony-prefetch', profile: 'google/1' }, 0, PREFETCH],
  ['a non-string profile', { type: 'ceremony-prefetch', profile: ['google/1'] }, 1, PREFETCH],
  ['a request without a client source', { type: 'ceremony-claim' }, 1, undefined],
])('closes every port of %s without replying', (_, data, count, url) => {
  const claim = vi.fn(async () => {})
  const ports = Array.from({ length: count }, port)
  const waitUntil = vi.fn()
  start({ clients: { claim } })('message', {
    data,
    ports,
    source: url === undefined ? null : { url },
    waitUntil,
  })
  for (const reply of ports) {
    expect(reply.close).toHaveBeenCalledOnce()
    expect(reply.postMessage).not.toHaveBeenCalled()
  }
  expect(waitUntil).not.toHaveBeenCalled()
  expect(claim).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it.each(['other/1', 'toString'])(
  'answers a request for an asset list it does not serve, %s, at once',
  (profile) => {
    const reply = port()
    const waitUntil = vi.fn()
    start()('message', {
      data: { type: 'ceremony-prefetch', profile },
      ports: [reply],
      source: { url: PREFETCH },
      waitUntil,
    })
    expect(reply.postMessage).toHaveBeenCalledExactlyOnceWith({ dispatched: false })
    expect(reply.close).toHaveBeenCalledOnce()
    expect(waitUntil).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  },
)

it.each([
  ['popup port keeper traffic', { type: 'popup-port' }],
  ['a non-record', 'ceremony-claim'],
  ['null', null],
])('passes %s through untouched', (_, data) => {
  const reply = port()
  const waitUntil = vi.fn()
  start()('message', { data, ports: [reply], source: { url: PREFETCH }, waitUntil })
  expect(reply.close).not.toHaveBeenCalled()
  expect(reply.postMessage).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
})
