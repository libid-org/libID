import { afterEach, expect, it, vi } from 'vitest'
import { fetchCeremonyConfig } from './config.js'

const wireConfig = {
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client' } },
}

afterEach(() => vi.unstubAllGlobals())

/** Validate `record` as the Bridge at `bridge` serves it. */
function served(record: unknown, bridge = 'https://bridge.test') {
  vi.stubGlobal('fetch', async () => Response.json(record))
  return fetchCeremonyConfig(bridge)
}

it('ignores unknown platforms and rejects oversized Google audiences', async () => {
  const config = await served(wireConfig)
  await expect(
    served({ ...wireConfig, platforms: { ...wireConfig.platforms, future: null } }),
  ).resolves.toMatchObject({ platforms: config.platforms })
  await expect(
    served({ ...wireConfig, platforms: { google: { clientId: 'x'.repeat(129) } } }),
  ).rejects.toThrow()
})

it('freezes the validated record [KIT-002] [TEST-BRIDGE-03]', async () => {
  const github = { clientId: 'client', clientCredential: 'public&original=1' }
  const config = await served({ ...wireConfig, platforms: { github } })
  expect(Object.isFrozen(config)).toBe(true)
  expect(Object.isFrozen(config.platforms)).toBe(true)
  expect(Object.isFrozen(config.platforms.github)).toBe(true)
  expect(config.platforms.github).toEqual(github)
})

it('accepts a local HTTP CCDP on a separate origin [LIBID-MOD-011]', async () => {
  for (const host of ['localhost', '127.0.0.1']) {
    const bridge = `http://${host}:4682`
    for (const ccdpOrigin of [`http://${host}`, `http://${host}:4683`])
      await expect(served({ ...wireConfig, ccdpOrigin }, bridge)).resolves.toMatchObject({
        ccdpOrigin,
        redirectUri: `${bridge}/auth/callback`,
      })
  }
  await expect(served({ ...wireConfig, ccdpOrigin: 'http://ccdp.test' })).rejects.toThrow()
})

it('validates configuration without coupling Bridge and CCDP [LIBID-OAUTH-001]', async () => {
  await expect(served(wireConfig)).resolves.toMatchObject({ ccdpOrigin: 'https://ccdp.test' })
  for (const patch of [
    { ccdpOrigin: 'https://ccdp.test/' },
    { callbackPath: '/auth/callback' },
    { redirectUri: 'https://bridge.test/auth/callback' },
    { allowedAppOrigins: [] },
  ])
    await expect(served({ ...wireConfig, ...patch })).rejects.toThrow()
})

it('fetches configuration once without credentials and bounds its body [LIBID-MOD-011]', async () => {
  const fetch = vi.fn(async () => Response.json(wireConfig))
  vi.stubGlobal('fetch', fetch)
  await expect(fetchCeremonyConfig('https://bridge.test')).resolves.toEqual({
    redirectUri: 'https://bridge.test/auth/callback',
    ccdpOrigin: 'https://ccdp.test',
    platforms: { google: { clientId: 'client' } },
  })
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
})
