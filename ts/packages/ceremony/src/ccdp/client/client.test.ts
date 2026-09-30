import { expect, it, vi } from 'vitest'
import { createCCDPClient } from './client.js'
import { VERSIONS_PATH } from './versions.js'

const wireConfig = {
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client' } },
}

it('creates a client from the Bridge record, then the Distribution list, refusing other options before fetching; either failing fails creation [LIBID-MOD-011] [LIBID-MOD-017]', async () => {
  const unfetched = vi.fn()
  vi.stubGlobal('fetch', unfetched)
  await expect(
    // @ts-expect-error Unknown options are rejected at runtime too.
    createCCDPClient({ oauthBridge: 'https://bridge.test', ccdpOrigin: 'https://ccdp.test' }),
  ).rejects.toThrow('Invalid client options')
  expect(unfetched).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  const init = { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error' }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const create = (record: () => Response, list: () => Response) => {
    const fetch = vi.fn(async (url: string) =>
      url === `https://bridge.test/api/v1/ceremony/config`
        ? record()
        : url === `https://ccdp.test${VERSIONS_PATH}`
          ? list()
          : new Response('Not found', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetch)
    return {
      fetch,
      client: createCCDPClient({ oauthBridge: 'https://bridge.test' }).finally(() =>
        vi.unstubAllGlobals(),
      ),
    }
  }
  const created = create(
    () => json(wireConfig),
    () => json({ google: [1], x: [1], future: [1] }),
  )
  const client = await created.client
  expect(created.fetch.mock.calls).toEqual([
    [`https://bridge.test/api/v1/ceremony/config`, init],
    [`https://ccdp.test${VERSIONS_PATH}`, init],
  ])
  expect(client.enabledPlatforms).toEqual(['google'])
  expect(client.enabledVersions('google')).toEqual([1])
  for (const [record, list, listRead] of [
    [() => json('Unavailable', 503), () => json({ google: [1] }), false],
    [() => json(wireConfig), () => new Response('Not found', { status: 404 }), true],
    [() => json(wireConfig), () => json({ google: [1, 1] }), true],
    [() => json(wireConfig), () => json([1]), true],
    [() => json(wireConfig), () => new Response('{', { status: 200 }), true],
  ] as const) {
    const failed = create(record, list)
    await expect(failed.client).rejects.toThrow()
    expect(failed.fetch).toHaveBeenCalledTimes(listRead ? 2 : 1)
  }
})
