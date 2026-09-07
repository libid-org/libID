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
