import { afterEach, expect, it, vi } from 'vitest'
import { AssetCache, validateResponse } from './cache.js'

const spec = { url: 'https://assets.example/g1', range: 'bytes=0-1', bytes: 2 }

afterEach(() => vi.unstubAllGlobals())

it('joins pending downloads and preserves independent readers and worker CSP in stored bodies', async () => {
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
  const cache = new AssetCache('https://ccdp.example'),
    first = cache.load(spec)
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

it.each([200, 404])('rejects status %i for range fetches', (status) =>
  expect(() => validateResponse(new Response(null, { status }), spec)).toThrow(),
)

it('allows unexposed range headers but rejects exposed mismatches and wrong lengths', () => {
  expect(() => validateResponse(new Response(null, { status: 206 }), spec)).not.toThrow()
  for (const headers of [
    new Headers({ 'Content-Range': 'bytes 2-3/100' }),
    new Headers({ 'Content-Length': '3' }),
  ])
    expect(() => validateResponse(new Response(null, { status: 206, headers }), spec)).toThrow()
})

it('storage denial still fetches; failed bodies never become a reusable flight', async () => {
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
  'uses the browser HTTP cache after a Cache Storage %s, retaining request options',
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
])('rejects invalid cached metadata and validates the fetched body', async (headers) => {
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
})

it.each([false, true])(
  'delivers validated bytes before persistence, keeping joiners until write completion (range=%s)',
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

it('absorbs failed writes, releases the pending entry and retries later', async () => {
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
  const cache = new AssetCache('https://ccdp.example'),
    spec = { url: 'https://ccdp.example/asset', bytes: 2 }
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
