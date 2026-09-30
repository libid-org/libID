import { expect, it, vi } from 'vitest'
import { VERSIONS_PATH } from '../../assets/keys.js'
import { fetchPlatformVersions, validatePlatformVersions } from './versions.js'

it('accepts ascending unsigned 16-bit lists under any platform key and freezes them [KIT-023]', () => {
  const versions = validatePlatformVersions({ google: [1], x: [0, 65535], future: [3, 7] })
  expect(versions).toEqual({ google: [1], x: [0, 65535], future: [3, 7] })
  expect(Object.isFrozen(versions)).toBe(true)
  expect(Object.isFrozen(versions.google)).toBe(true)
  expect(validatePlatformVersions({})).toEqual({})
})

it('refuses the whole list on any violation, under an unknown platform key too [KIT-023]', () => {
  for (const list of [
    null,
    [],
    'x',
    1,
    { google: null },
    { google: 1 },
    { google: '1' },
    { google: {} },
    { google: [] },
    { google: [1, 1] },
    { google: [2, 1] },
    { google: [1.5] },
    { google: ['1'] },
    { google: [-1] },
    { google: [65536] },
    { google: [Number.NaN] },
    { google: [null] },
    { google: [1, undefined] },
    { google: [1], future: [] },
    { google: [1], future: [1, 1] },
    { google: [1], future: [2, 1] },
  ])
    expect(() => validatePlatformVersions(list)).toThrow()
})

it('fetches the list from the Distribution without credentials, caching or redirects [KIT-023]', async () => {
  const json = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = vi.fn(async () => json('{"google":[1]}'))
  vi.stubGlobal('fetch', fetch)
  try {
    expect(await fetchPlatformVersions('https://ccdp.test')).toEqual({ google: [1] })
    expect(fetch).toHaveBeenCalledWith(`https://ccdp.test${VERSIONS_PATH}`, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    fetch.mockResolvedValueOnce(json('{"google":[1]}', 503))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow(
      'Version list request failed',
    )
    fetch.mockResolvedValueOnce(json('{"google":[1,1]}'))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
    fetch.mockResolvedValueOnce(json('{'))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
    fetch.mockResolvedValueOnce(json(`${' '.repeat(64 * 1024)}{}`))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
  } finally {
    vi.unstubAllGlobals()
  }
})
