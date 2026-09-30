import { expect, it, vi } from 'vitest'
import { fetchCeremonyConfig, validateCeremonyConfig } from './config.js'

const wireConfig = {
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client' } },
}

const config = validateCeremonyConfig(wireConfig, 'https://bridge.test')

it('ignores unknown platforms and rejects oversized Google audiences', () => {
  expect(
    validateCeremonyConfig(
      { ...wireConfig, platforms: { ...wireConfig.platforms, future: null } },
      'https://bridge.test',
    ).platforms,
  ).toEqual(config.platforms)
  expect(() =>
    validateCeremonyConfig(
      {
        ...wireConfig,
        platforms: { google: { clientId: 'x'.repeat(129) } },
      },
      'https://bridge.test',
    ),
  ).toThrow()
})
it('accepts a local HTTP CCDP on a separate origin [LIBID-MOD-011]', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    const bridge = `http://${host}:4682`
    for (const ccdpOrigin of [`http://${host}`, `http://${host}:4683`]) {
      const local = { ...wireConfig, ccdpOrigin }
      expect(validateCeremonyConfig(local, bridge)).toMatchObject({
        ccdpOrigin,
        redirectUri: `${bridge}/auth/callback`,
      })
    }
  }
  expect(() =>
    validateCeremonyConfig(
      { ...wireConfig, ccdpOrigin: 'http://ccdp.test' },
      'https://bridge.test',
    ),
  ).toThrow()
})
it('validates configuration without coupling Bridge and CCDP [LIBID-OAUTH-001]', () => {
  expect(validateCeremonyConfig(wireConfig, 'https://bridge.test').ccdpOrigin).toBe(
    'https://ccdp.test',
  )
  for (const patch of [
    { ccdpOrigin: 'https://ccdp.test/' },
    { callbackPath: '/auth/callback' },
    { redirectUri: 'https://bridge.test/auth/callback' },
    { allowedAppOrigins: [] },
  ])
    expect(() =>
      validateCeremonyConfig({ ...wireConfig, ...patch }, 'https://bridge.test'),
    ).toThrow()
})

it('fetches configuration once without credentials and bounds its body [LIBID-MOD-011]', async () => {
  const fetch = vi.fn(async () => Response.json(wireConfig))
  vi.stubGlobal('fetch', fetch)
  try {
    await expect(fetchCeremonyConfig('https://bridge.test')).resolves.toEqual(config)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://bridge.test/api/v1/ceremony/config', {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    fetch.mockResolvedValueOnce(Response.json({ ...wireConfig, padding: 'x'.repeat(64 * 1024) }))
    await expect(fetchCeremonyConfig('https://bridge.test')).rejects.toThrow('limit')
    await expect(fetchCeremonyConfig('https://bridge.test/')).rejects.toThrow('oauthBridge')
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(fetchCeremonyConfig('https://bridge.test')).rejects.toThrow('request failed')
  } finally {
    vi.unstubAllGlobals()
  }
})
