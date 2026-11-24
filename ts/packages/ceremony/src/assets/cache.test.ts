import { afterEach, expect, it, vi } from 'vitest'
import { AssetCache } from './cache.js'
import type { AssetRequest } from './index.js'

const spec = { url: 'https://assets.example/g1', range: 'bytes=0-1', bytes: 2 }

afterEach(() => vi.unstubAllGlobals())

/** Deliver `request` through an empty cache whose network answers with `response`. */
function served(response: Response, request: AssetRequest = spec) {
  vi.stubGlobal('caches', {
    open: async () => ({ match: async () => undefined, put: async () => {} }),
  })
  vi.stubGlobal('fetch', async () => response)
  return new AssetCache('https://ccdp.example').load(request).response
}

/** A body of `bytes` zero bytes under `init`. */
const body = (bytes: number, init: ResponseInit = {}) => new Response(new Uint8Array(bytes), init)

it('joins pending downloads and preserves independent readers and worker CSP in stored bodies [CSP-019] [LIBID-ASSET-019] [LIBID-ASSET-021] [LIBID-PROVER-016]', async () => {
  const stored = new Map<string, Response>()
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (k: string) => stored.get(k)?.clone(),
      put: async (k: string, r: Response) => {
        stored.set(k, r)
      },
      delete: async (k: string) => stored.delete(k),
    }),
  })
  let resolve!: (response: Response) => void
  const fetching = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r
      }),
  )
  vi.stubGlobal('fetch', fetching)
  const cache = new AssetCache('https://ccdp.example')
  const first = cache.load(spec)
  await first.dispatched
  expect(fetching).toHaveBeenCalledTimes(1)
  const second = cache.load(spec)
  await second.dispatched
  expect(fetching).toHaveBeenCalledTimes(1)
  resolve(
    new Response(new Uint8Array([4, 5]), {
      status: 206,
      headers: {
        'Content-Security-Policy': "default-src 'none'",
        'Content-Range': 'bytes 0-1/100',
      },
    }),
  )
  const [a, b] = await Promise.all([first.response, second.response])
  expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([4, 5]))
  expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([4, 5]))
  const hit = await cache.load(spec).response
  expect(hit.status).toBe(206)
  expect(hit.headers.get('content-security-policy')).toBe("default-src 'none'")
  expect(fetching).toHaveBeenCalledTimes(1)
})

it.each([200, 404])('rejects status %i for range fetches [LIBID-ASSET-021]', async (status) => {
  await expect(served(body(2, { status }))).rejects.toThrow('Invalid asset response')
})

it('allows unexposed range headers but rejects exposed mismatches and wrong lengths [LIBID-ASSET-021]', async () => {
  await expect(served(body(2, { status: 206 }))).resolves.toBeInstanceOf(Response)
  await expect(
    served(body(2, { status: 206, headers: { 'Content-Range': 'bytes 2-3/100' } })),
  ).rejects.toThrow('Unexpected asset range')
  await expect(
    served(body(2, { status: 206, headers: { 'Content-Length': '3' } })),
  ).rejects.toThrow('Unexpected asset size')
})

it('checks the exposed length only where the encoding is visible too [LIBID-ASSET-021]', async () => {
  const declared = { url: spec.url, bytes: 100 }
  const compressed = () => body(100, { headers: { 'Content-Length': '40' } })
  await expect(served(compressed(), declared)).rejects.toThrow('Unexpected asset size')
  const cors = Object.defineProperty(compressed(), 'type', { value: 'cors' })
  await expect(served(cors, declared)).resolves.toBeInstanceOf(Response)
})

it('rejects a malformed Content-Range even without a requested range [LIBID-ASSET-021]', async () => {
  for (const range of ['bytes 0-1/0x10', 'bytes 0-1', 'items 0-1/2'])
    await expect(
      served(body(2, { headers: { 'Content-Range': range } }), { url: spec.url }),
    ).rejects.toThrow('Unexpected asset range')
})

it('storage denial still fetches; failed bodies never become a reusable flight [LIBID-ASSET-019]', async () => {
  vi.stubGlobal('caches', {
    open: async () => {
      throw new Error('denied')
    },
  })
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { status: 206 }))
  vi.stubGlobal('fetch', fetcher)
  const cache = new AssetCache('https://ccdp.example')
  await expect(cache.load(spec).response).rejects.toThrow('Incomplete')
  await expect(cache.load(spec).response).rejects.toThrow('Incomplete')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each(['application/wasm', 'text/javascript'])(
  'returns ordinary cached %s bodies without consuming them',
  async (mime) => {
    const hit = new Response(new Uint8Array([4, 5]), {
      headers: {
        'Content-Type': mime,
        'Content-Length': '2',
        'Content-Security-Policy': "default-src 'none'",
      },
    })
    vi.stubGlobal('caches', { open: async () => ({ match: async () => hit }) })
    const fetching = vi.fn()
    vi.stubGlobal('fetch', fetching)
    const loaded = new AssetCache('https://ccdp.example').load({
      url: 'https://ccdp.example/asset',
      bytes: 2,
      mime,
    })
    const result = await loaded.response
    await loaded.dispatched
    expect(hit.bodyUsed).toBe(false)
    expect(fetching).not.toHaveBeenCalled()
    expect(result.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([4, 5]))
  },
)

it.each(['miss', 'denied'])(
  'uses the browser HTTP cache after a Cache Storage %s, retaining request options [LIBID-ASSET-021]',
  async (storage) => {
    vi.stubGlobal('caches', {
      open: async () => {
        if (storage === 'denied') throw new Error('denied')
        return { match: async () => undefined, put: async () => {} }
      },
    })
    const fetching = vi.fn(async () => new Response(new Uint8Array([4, 5]), { status: 206 }))
    vi.stubGlobal('fetch', fetching)
    await new AssetCache('https://ccdp.example').load(spec).response
    expect(fetching).toHaveBeenCalledWith(spec.url, {
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      headers: { Range: spec.range },
      cache: 'force-cache',
    })
  },
)

it.each([
  { 'Content-Type': 'text/html', 'Content-Length': '2' },
  { 'Content-Type': 'application/wasm', 'Content-Length': '3' },
])(
  'rejects invalid cached metadata and validates the fetched body [LIBID-ASSET-019]',
  async (headers) => {
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => new Response(new Uint8Array([4, 5]), { headers }),
        put: async () => {},
      }),
    })
    const fetching = vi.fn(
      async () =>
        new Response(new Uint8Array([4]), {
          headers: { 'Content-Type': 'application/wasm' },
        }),
    )
    vi.stubGlobal('fetch', fetching)
    await expect(
      new AssetCache('https://ccdp.example').load({
        url: 'https://ccdp.example/asset.wasm',
        bytes: 2,
        mime: 'application/wasm',
      }).response,
    ).rejects.toThrow('Incomplete')
    expect(fetching).toHaveBeenCalledTimes(1)
  },
)

it.each([false, true])(
  'delivers validated bytes before persistence, keeping joiners until write completion (range=%s) [LIBID-ASSET-019] [LIBID-ASSET-021]',
  async (range) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const stored = new Map<string, Response>()
    const put = vi.fn(async (key: string, response: Response) => {
      await held
      stored.set(key, response)
    })
    vi.stubGlobal('caches', {
      open: async () => ({ match: async (key: string) => stored.get(key)?.clone(), put }),
    })
    const fetcher = vi.fn(
      async () => new Response(new Uint8Array([4, 5]), { status: range ? 206 : 200 }),
    )
    vi.stubGlobal('fetch', fetcher)
    const cache = new AssetCache('https://ccdp.example')
    const spec = {
      url: 'https://ccdp.example/asset',
      bytes: 2,
      ...(range ? { range: 'bytes=0-1' } : {}),
    }
    const first = cache.load(spec)
    let complete = false
    void first.complete.then(() => {
      complete = true
    })
    const a = await first.response
    expect(Array.from(new Uint8Array(await a.arrayBuffer()))).toEqual([4, 5])
    expect(a.status).toBe(range ? 206 : 200)
    expect(complete).toBe(false)
    expect(stored.size).toBe(0)
    const joined = cache.load(spec)
    expect(joined.complete).toBe(first.complete)
    expect(Array.from(new Uint8Array(await (await joined.response).arrayBuffer()))).toEqual([4, 5])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    release()
    await first.complete
    expect(complete).toBe(true)
    await cache.load(spec).response
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it('absorbs failed writes, releases the pending entry and retries later [LIBID-ASSET-019]', async () => {
  let reject!: (error: Error) => void
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async () => undefined,
      put: () =>
        new Promise<void>((_, r) => {
          reject = r
        }),
    }),
  })
  const fetcher = vi.fn(async () => new Response(new Uint8Array([4, 5])))
  vi.stubGlobal('fetch', fetcher)
  const cache = new AssetCache('https://ccdp.example')
  const spec = { url: 'https://ccdp.example/asset', bytes: 2 }
  const first = cache.load(spec)
  await first.response
  reject(new Error('quota'))
  await first.complete
  const second = cache.load(spec)
  await second.response
  expect(fetcher).toHaveBeenCalledTimes(2)
  reject(new Error('quota'))
  await second.complete
})

it('reconciles exact URLs and ranges across the whole release without rewriting retained entries [TEST-DIST-07]', async () => {
  const origin = 'https://ccdp.example'
  const required = [
    { url: `${origin}/ccdp/assets/shared/v1.js` },
    { url: `${origin}/ccdp/assets/shared/v2.js` },
    { url: `${origin}/ccdp/assets/another-platform.wasm` },
    { url: 'https://external.test/crs', range: 'bytes=0-1' },
    { url: 'https://external.test/crs', range: 'bytes=2-3' },
  ]
  const obsolete = [
    { url: `${origin}/ccdp/assets/old.js` },
    { url: 'https://external.test/crs', range: 'bytes=0-3' },
  ]
  const stored = new Map<string, Response>()
  const deleted = vi.fn(async (key: Request) => stored.delete(key.url))
  const open = vi.fn(async (_name: string) => ({
    match: async (key: string) => stored.get(key)?.clone(),
    put: async (key: string, value: Response) => {
      stored.set(key, value)
    },
    keys: async () => [...stored.keys()].map((key) => new Request(key)),
    delete: deleted,
  }))
  vi.stubGlobal('caches', { open })
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) =>
    body(2, { status: (init.headers as Record<string, string>).Range ? 206 : 200 }),
  )
  const cache = new AssetCache(origin)
  for (const spec of required) await cache.load(spec).complete
  const retained = new Map(stored)
  for (const spec of obsolete) await cache.load(spec).complete
  const unrelated = `${origin}/another-app`
  stored.set(unrelated, new Response('untouched'))
  const other = stored.get(unrelated)
  await cache.reconcile(required)
  expect(stored.size).toBe(required.length + 1)
  for (const [key, response] of retained) expect(stored.get(key)).toBe(response)
  expect(stored.get(unrelated)).toBe(other)
  expect(deleted).toHaveBeenCalledTimes(2)
  await cache.reconcile(required)
  expect(deleted).toHaveBeenCalledTimes(2)
  expect(open.mock.calls.every(([name]) => name === 'libid-ceremony-assets-v1')).toBe(true)
})

it.each(['open', 'keys', 'delete'])(
  'failed reconciliation at %s does not disable asset delivery [TEST-DIST-07]',
  async (failure) => {
    const origin = 'https://ccdp.example'
    const denied = () => {
      throw new Error('storage denied')
    }
    vi.stubGlobal('caches', {
      open: async () => {
        if (failure === 'open') denied()
        return {
          keys: async () => {
            if (failure === 'keys') denied()
            return [new Request(`${origin}/__libid_ceremony_cache__/obsolete`)]
          },
          delete: async () => denied(),
          match: async () => undefined,
          put: async () => {},
        }
      },
    })
    vi.stubGlobal('fetch', async () => body(2))
    const cache = new AssetCache(origin)
    const spec = { url: `${origin}/current`, bytes: 2 }
    await expect(cache.reconcile([spec])).resolves.toBeUndefined()
    const loaded = cache.load(spec)
    expect((await (await loaded.response).arrayBuffer()).byteLength).toBe(2)
    await loaded.complete
  },
)

it('names each load source and settles only network retrievals still running [LIBID-BROWSER-029]', async () => {
  const stored = new Map<string, Response>()
  const persisting = Promise.withResolvers<void>()
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (k: string) => stored.get(k)?.clone(),
      keys: async () => [...stored.keys()].map((k) => new Request(k)),
      // Persistence outlives delivery, keeping a settled load pending.
      put: async (k: string, r: Response) => {
        await persisting.promise
        stored.set(k, r)
      },
    }),
  })
  const network = Promise.withResolvers<Response>()
  const fetching = vi.fn(() => network.promise)
  vi.stubGlobal('fetch', fetching)
  const cache = new AssetCache('https://ccdp.example')
  const full = { url: 'https://assets.example/wasm', bytes: 1 }
  const first = cache.load(full)
  expect(await first.dispatched).toBe('network')
  // A joiner shares the running retrieval and its source.
  expect(await cache.load(full).dispatched).toBe('network')
  expect(fetching).toHaveBeenCalledOnce()
  const settled = vi.fn()
  // `spec` is neither loading nor stored.
  void cache.remaining([full, spec]).then(settled)
  await new Promise((resolve) => setTimeout(resolve))
  expect(settled).not.toHaveBeenCalled()
  network.resolve(new Response(new Uint8Array([1])))
  await first.response
  await vi.waitFor(() =>
    expect(settled).toHaveBeenCalledExactlyOnceWith({ pending: 1, missing: 1 }),
  )
  // Delivered but still persisting: neither running nor missing, and a joiner reads its bytes.
  expect(await cache.remaining([full])).toEqual({ pending: 0, missing: 0 })
  expect(await cache.load(full).dispatched).toBe('cache')
  expect(fetching).toHaveBeenCalledOnce()
  persisting.resolve()
  await first.complete
  // Stored: a later load is a cache hit, and its lookup is not a retrieval.
  const hit = cache.load(full)
  expect(await cache.remaining([full])).toEqual({ pending: 0, missing: 0 })
  expect(await hit.dispatched).toBe('cache')
  await hit.complete

  // A failed retrieval is settled too, and is missing afterwards.
  vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  const failed = cache.load(spec)
  await failed.dispatched
  const report = cache.remaining([spec])
  await expect(failed.response).rejects.toThrow('Invalid asset response')
  expect(await report).toEqual({ pending: 1, missing: 0 })
  await failed.complete
  expect(await cache.remaining([spec])).toEqual({ pending: 0, missing: 1 })
})

it('counts every spec missing when Cache Storage is inaccessible [LIBID-BROWSER-029]', async () => {
  vi.stubGlobal('caches', {
    open: async () => {
      throw new DOMException('denied', 'SecurityError')
    },
  })
  expect(await new AssetCache('https://ccdp.example').remaining([spec])).toEqual({
    pending: 0,
    missing: 1,
  })
})

it('streams ranged cached bodies as 206 without eagerly consuming them', async () => {
  const hit = new Response(new Uint8Array([4, 5]), {
    headers: {
      'Content-Length': '2',
      'Content-Range': 'bytes 0-1/100',
    },
  })
  vi.stubGlobal('caches', { open: async () => ({ match: async () => hit }) })
  const fetching = vi.fn()
  vi.stubGlobal('fetch', fetching)
  const loaded = new AssetCache('https://ccdp.example').load(spec)
  const result = await loaded.response
  expect(await loaded.dispatched).toBe('cache')
  expect(hit.bodyUsed).toBe(false)
  expect(fetching).not.toHaveBeenCalled()
  expect(result.status).toBe(206)
  expect(result.headers.get('content-range')).toBe('bytes 0-1/100')
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([4, 5]))
  await loaded.complete
})

it('warm prefetch validates ranged cached metadata without consuming or locking the body', async () => {
  const hit = new Response(new Uint8Array([4, 5]), {
    headers: {
      'Content-Length': '2',
      'Content-Range': 'bytes 0-1/100',
    },
  })
  vi.stubGlobal('caches', { open: async () => ({ match: async () => hit }) })
  const fetching = vi.fn()
  vi.stubGlobal('fetch', fetching)
  const job = new AssetCache('https://ccdp.example').prefetch(spec)
  expect(await job.dispatched).toBe('cache')
  await job.complete
  expect(hit.bodyUsed).toBe(false)
  expect(hit.body?.locked).toBe(false)
  expect(fetching).not.toHaveBeenCalled()
})

it.each([
  ['wrong status', { status: 206, headers: { 'Content-Length': '2' } }],
  ['missing Content-Length', { headers: {} }],
  ['wrong Content-Length', { headers: { 'Content-Length': '1' } }],
  ['Content-Encoding present', { headers: { 'Content-Length': '2', 'Content-Encoding': 'gzip' } }],
  [
    'mismatched Content-Range',
    { headers: { 'Content-Length': '2', 'Content-Range': 'bytes 2-3/100' } },
  ],
])('evicts and refetches cached ranged entries with %s on prefetch and load', async (_, init) => {
  for (const mode of ['prefetch', 'load'] as const) {
    const stored = new Map<string, Response>()
    const del = vi.fn(async () => true)
    const put = vi.fn(async (k: string, r: Response) => {
      stored.set(k, r)
    })
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => new Response(new Uint8Array([4, 5]), init),
        delete: del,
        put,
      }),
    })
    const fetching = vi.fn(
      async () =>
        new Response(new Uint8Array([6, 7]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-1/100' },
        }),
    )
    vi.stubGlobal('fetch', fetching)
    const cache = new AssetCache('https://ccdp.example')
    if (mode === 'prefetch') {
      const job = cache.prefetch(spec)
      expect(await job.dispatched).toBe('network')
      await job.complete
    } else {
      const job = cache.load(spec)
      expect(await job.dispatched).toBe('network')
      const response = await job.response
      expect(response.status).toBe(206)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([6, 7]))
      await job.complete
    }
    expect(del).toHaveBeenCalledOnce()
    expect(fetching).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
    expect(stored.size).toBe(1)
  }
})

it('joins single-flight fetches between prefetch and load and cleans up failed prefetches', async () => {
  const stored = new Map<string, Response>()
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (k: string) => stored.get(k)?.clone(),
      put: async (k: string, r: Response) => {
        stored.set(k, r)
      },
      delete: async (k: string) => stored.delete(k),
    }),
  })
  const network = Promise.withResolvers<Response>()
  const fetching = vi.fn(() => network.promise)
  vi.stubGlobal('fetch', fetching)
  const cache = new AssetCache('https://ccdp.example')
  const first = cache.prefetch(spec)
  expect(await first.dispatched).toBe('network')
  const second = cache.prefetch(spec)
  const loaded = cache.load(spec)
  expect(await second.dispatched).toBe('network')
  expect(await loaded.dispatched).toBe('network')
  expect(second.complete).toBe(first.complete)
  expect(loaded.complete).toBe(first.complete)
  expect(fetching).toHaveBeenCalledOnce()
  network.resolve(
    new Response(new Uint8Array([8, 9]), {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-1/100' },
    }),
  )
  const response = await loaded.response
  expect(response.status).toBe(206)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([8, 9]))
  await first.complete

  // A failed prefetch settles without unhandled rejection and releases its pending flight.
  const other = { url: 'https://assets.example/missing', range: 'bytes=0-1', bytes: 2 }
  const failing = vi.fn(async () => new Response(null, { status: 404 }))
  vi.stubGlobal('fetch', failing)
  const failed = cache.prefetch(other)
  expect(await failed.dispatched).toBe('network')
  await failed.complete
  await expect(cache.load(other).response).rejects.toThrow('Invalid asset response')
  expect(failing).toHaveBeenCalledTimes(2)
})

it('awaits in-flight cache lookups before classifying remaining loads and checks idle specs via keys [LIBID-BROWSER-029]', async () => {
  const origin = 'https://ccdp.example'
  const cachedSpec = { url: 'https://assets.example/cached', bytes: 1 }
  const missedSpec = { url: 'https://assets.example/missed', bytes: 1 }
  const idleStored = { url: 'https://assets.example/idle-stored', bytes: 1 }
  const idleMissing = { url: 'https://assets.example/idle-missing', bytes: 1 }
  const stored = new Map<string, Response>()
  const lookupGate = Promise.withResolvers<void>()
  let gateActive = false
  const match = vi.fn(async (k: string) => {
    if (gateActive) await lookupGate.promise
    return stored.get(k)?.clone()
  })
  const keys = vi.fn(async () => [...stored.keys()].map((k) => new Request(k)))
  vi.stubGlobal('caches', {
    open: async () => ({
      match,
      keys,
      put: async (k: string, r: Response) => {
        stored.set(k, r)
      },
    }),
  })
  const network = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1]))),
  )
  const cache = new AssetCache(origin)
  await cache.load(cachedSpec).complete
  await cache.load(idleStored).complete
  match.mockClear()
  keys.mockClear()

  // Hold cache lookups open so both loads are in the 'lookup' stage when remaining() starts.
  gateActive = true
  vi.stubGlobal(
    'fetch',
    vi.fn(() => network.promise),
  )
  const hitLoad = cache.load(cachedSpec)
  const missLoad = cache.load(missedSpec)
  const settled = vi.fn()
  const report = cache.remaining([cachedSpec, missedSpec, idleStored, idleMissing]).then((r) => {
    settled(r)
    return r
  })
  await vi.waitFor(() => expect(keys).toHaveBeenCalledOnce())
  // Idle specs were checked through a single keys() call, never cache.match().
  expect(match).toHaveBeenCalledTimes(2)
  expect(settled).not.toHaveBeenCalled()

  lookupGate.resolve()
  expect(await hitLoad.dispatched).toBe('cache')
  expect(await missLoad.dispatched).toBe('network')
  await new Promise((resolve) => setTimeout(resolve))
  // The missed lookup became a running retrieval, so remaining() still waits for it.
  expect(settled).not.toHaveBeenCalled()

  network.resolve(new Response(new Uint8Array([2])))
  expect(await report).toEqual({ pending: 1, missing: 1 })
  await Promise.all([hitLoad.complete, missLoad.complete])
})

it('coalesces concurrent caches.open calls without retaining a handle across cache deletion', async () => {
  let stored = new Map<string, Response>()
  let failOpen = false
  const open = vi.fn(async () => {
    if (failOpen) throw new Error('storage unavailable')
    const backing = stored
    return {
      match: async (k: string) => backing.get(k)?.clone(),
      keys: async () => [...backing.keys()].map((k) => new Request(k)),
      put: async (k: string, r: Response) => {
        backing.set(k, r)
      },
      delete: async (k: string) => backing.delete(k),
    }
  })
  vi.stubGlobal('caches', { open })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2]))),
  )

  const a = { url: 'https://assets.example/a', bytes: 2 }
  const b = { url: 'https://assets.example/b', bytes: 2 }
  const cache = new AssetCache('https://ccdp.example')
  // Concurrent prefetches share one in-flight caches.open() call.
  await Promise.all([cache.prefetch(a).complete, cache.prefetch(b).complete])
  expect(open).toHaveBeenCalledTimes(1)
  expect(stored.size).toBe(2)

  // External cache deletion replaces the backing store; the next load opens the fresh handle.
  stored = new Map<string, Response>()
  await cache.load(a).complete
  expect(open).toHaveBeenCalledTimes(2)
  expect(stored.size).toBe(1)

  // A failed open clears the in-flight slot so a later call recovers once storage is available.
  failOpen = true
  await cache.load(b).complete
  expect(open).toHaveBeenCalledTimes(3)
  failOpen = false
  await cache.load(b).complete
  expect(open).toHaveBeenCalledTimes(4)
  expect(stored.size).toBe(2)
})

it('serves concurrent network loads and cache persistence without calling Response.clone()', async () => {
  const cloneSpy = vi.spyOn(Response.prototype, 'clone')
  try {
    const stored = new Map<string, Response>()
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => undefined,
        put: async (k: string, r: Response) => {
          stored.set(k, r)
        },
      }),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([9, 8]), { status: 206 })),
    )
    const cache = new AssetCache('https://ccdp.example')
    const first = cache.load(spec)
    const second = cache.load(spec)
    const [a, b] = await Promise.all([first.response, second.response])
    await first.complete
    expect(cloneSpy).not.toHaveBeenCalled()
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([9, 8]))
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([9, 8]))
    expect(new Uint8Array(await [...stored.values()][0].arrayBuffer())).toEqual(
      new Uint8Array([9, 8]),
    )
  } finally {
    cloneSpy.mockRestore()
  }
})

it('prefetchAll probes cache.keys() once, skips cache.match() on cold entries, and validates warm ones', async () => {
  const origin = 'https://ccdp.example'
  const warm = { url: `${origin}/warm`, bytes: 2 }
  const cold = { url: `${origin}/cold`, bytes: 2 }
  const stored = new Map<string, Response>()
  const match = vi.fn(async (k: string) => stored.get(k)?.clone())
  const keys = vi.fn(async () => [...stored.keys()].map((k) => new Request(k)))
  const put = vi.fn(async (k: string, r: Response) => {
    stored.set(k, r)
  })
  const open = vi.fn(async () => ({ match, keys, put }))
  vi.stubGlobal('caches', { open })
  const fetching = vi.fn(async () => new Response(new Uint8Array([1, 2])))
  vi.stubGlobal('fetch', fetching)

  const cache = new AssetCache(origin)
  // Seed one warm entry first.
  await cache.load(warm).complete
  open.mockClear()
  match.mockClear()
  keys.mockClear()
  fetching.mockClear()

  // Batch prefetch checks keys once, validates only `warm`, and fetches `cold` without matching it.
  const batch = cache.prefetchAll([warm, cold])
  // Concurrent load joins the cold flight synchronously while keys() is still in flight.
  const joined = cache.load(cold)
  expect(await batch.dispatched).toEqual(['cache', 'network'])
  expect(await joined.dispatched).toBe('network')
  expect(new Uint8Array(await (await joined.response).arrayBuffer())).toEqual(
    new Uint8Array([1, 2]),
  )
  await batch.complete
  expect(open).toHaveBeenCalledTimes(1)
  expect(keys).toHaveBeenCalledTimes(1)
  expect(match).toHaveBeenCalledTimes(1)
  expect(fetching).toHaveBeenCalledTimes(1)

  // Already-pending flights skip probing altogether.
  open.mockClear()
  const slow = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => slow.promise),
  )
  const extra = { url: `${origin}/extra`, bytes: 2 }
  const pending = cache.load(extra)
  await pending.dispatched
  open.mockClear()
  const again = cache.prefetchAll([extra])
  expect(await again.dispatched).toEqual(['network'])
  expect(open).not.toHaveBeenCalled()
  slow.resolve(new Response(new Uint8Array([3, 4])))
  await again.complete
})

it.each(['open', 'keys'])(
  'prefetchAll degrades cleanly when Cache Storage %s fails',
  async (failure) => {
    const match = vi.fn(async () => undefined)
    const open = vi.fn(async () => {
      if (failure === 'open') throw new Error('storage denied')
      return {
        match,
        keys: async () => {
          throw new Error('keys unsupported')
        },
        put: async () => {},
      }
    })
    vi.stubGlobal('caches', { open })
    const fetching = vi.fn(async () => new Response(new Uint8Array([1, 2])))
    vi.stubGlobal('fetch', fetching)
    const cache = new AssetCache('https://ccdp.example')
    const specs = [
      { url: 'https://ccdp.example/a', bytes: 2 },
      { url: 'https://ccdp.example/b', bytes: 2 },
    ]
    const batch = cache.prefetchAll(specs)
    expect(await batch.dispatched).toEqual(['network', 'network'])
    await batch.complete
    expect(open).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(match).toHaveBeenCalledTimes(failure === 'open' ? 0 : 2)
  },
)
