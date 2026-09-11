import { expect, it, vi } from 'vitest'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('./cache.js', () => ({
  AssetCache: class {
    load = load
  },
}))

vi.mock('@libid/popup/worker', () => ({ installPortKeeper: vi.fn() }))

vi.mock('virtual:ceremony-assets', () => ({
  requestsByProfile: { 'google/1': [{ url: '/asset' }] },
  allowedRequests: [{ url: '/asset' }],
}))

import { startWorker } from './worker.js'

it.each(['fetch', 'message', 'failed-prefetch'])(
  'keeps %s lifetime tied to persistence after response delivery',
  async (type) => {
    let finish!: () => void
    const complete = new Promise<void>((resolve) => {
      finish = resolve
    })
    const response =
      type === 'failed-prefetch'
        ? Promise.reject(new Error('asset unavailable'))
        : Promise.resolve(new Response(new Uint8Array([1])))
    load.mockReturnValue({ dispatched: Promise.resolve(), response, complete })
    const handlers = new Map<string, (event: unknown) => void>()
    startWorker({
      location: { origin: 'https://ccdp.example' },
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
    } as unknown as ServiceWorkerGlobalScope)
    const waits: Promise<unknown>[] = [],
      respondWith = vi.fn()
    handlers.get(type === 'fetch' ? 'fetch' : 'message')!({
      request: new Request('https://ccdp.example/asset'),
      respondWith,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      data: { type: 'ceremony-prefetch', profile: 'google/1' },
      ports: [{ postMessage: vi.fn(), close: vi.fn() }],
      source: { url: 'https://ccdp.example/ccdp/v1/prefetch' },
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
    finish()
    await waits[0]
    expect(settled).toBe(true)
  },
)
