import { expect, it, vi } from 'vitest'
import { VERSIONS_PATH } from '../../assets/keys.js'
import {
  fetchPlatformVersions,
  validateDistributionVersions,
  validatePlatformVersions,
} from './versions.js'

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

it('validates the exact Distribution envelope and safe ascending CCDP versions [KIT-023] [TEST-DIST-06]', () => {
  const record = { ccdpVersions: [1, Number.MAX_SAFE_INTEGER], platforms: { future: [0, 65535] } }
  const versions = validateDistributionVersions(record)
  expect(versions).toEqual(record)
  expect(Object.isFrozen(versions)).toBe(true)
  expect(Object.isFrozen(versions.ccdpVersions)).toBe(true)
  expect(Object.isFrozen(versions.platforms)).toBe(true)
  for (const invalid of [
    null,
    [],
    {},
    { google: [1] },
    { ccdpVersions: [1] },
    { platforms: {} },
    { ...record, extra: true },
    ...[
      null,
      1,
      {},
      [],
      [0],
      [-1],
      [1.5],
      ['1'],
      [1, 1],
      [2, 1],
      [NaN],
      [Infinity],
      [Number.MAX_SAFE_INTEGER + 1],
    ].map((ccdpVersions) => ({ ...record, ccdpVersions })),
    { ...record, platforms: { future: [] } },
    { ...record, platforms: null },
  ])
    expect(() => validateDistributionVersions(invalid)).toThrow()
})

it('fetches the list from the Distribution without credentials, caching or redirects [KIT-023]', async () => {
  const json = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  const record = (platforms: unknown, ccdpVersions = [1]) =>
    JSON.stringify({ ccdpVersions, platforms })
  const fetch = vi.fn(async () => json(record({ google: [1] })))
  vi.stubGlobal('fetch', fetch)
  try {
    expect(await fetchPlatformVersions('https://ccdp.test')).toEqual({ google: [1] })
    expect(fetch).toHaveBeenCalledWith(`https://ccdp.test${VERSIONS_PATH}`, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    fetch.mockResolvedValueOnce(json(record({ google: [1] }), 503))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow(
      'Version list request failed',
    )
    fetch.mockResolvedValueOnce(json(record({ google: [1, 1] })))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
    fetch.mockResolvedValueOnce(json(record({ google: [1] }, [2])))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow(
      'does not support this CCDP version',
    )
    fetch.mockResolvedValueOnce(json('{'))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
    fetch.mockResolvedValueOnce(json(`${' '.repeat(64 * 1024)}{}`))
    await expect(fetchPlatformVersions('https://ccdp.test')).rejects.toThrow()
  } finally {
    vi.unstubAllGlobals()
  }
})
