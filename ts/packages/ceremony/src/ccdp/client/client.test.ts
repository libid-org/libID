import { expect, it, vi } from 'vitest'
import { VERSIONS_PATH } from '../../assets/keys.js'
import { createCCDPClient } from './client.js'

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
    () => json({ ccdpVersions: [1], platforms: { google: [1], x: [1], future: [1] } }),
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
    [
      () => json(wireConfig),
      () => json({ ccdpVersions: [1], platforms: { google: [1, 1] } }),
      true,
    ],
    [() => json(wireConfig), () => json([1]), true],
    [() => json(wireConfig), () => json({ ccdpVersions: [2], platforms: { google: [1] } }), true],
    [() => json(wireConfig), () => new Response('{', { status: 200 }), true],
  ] as const) {
    const failed = create(record, list)
    await expect(failed.client).rejects.toThrow()
    expect(failed.fetch).toHaveBeenCalledTimes(listRead ? 2 : 1)
  }
})

it('forwards an optional AbortSignal to both discovery fetches and stops on abort', async () => {
  const unfetched = vi.fn()
  vi.stubGlobal('fetch', unfetched)
  try {
    await expect(
      // @ts-expect-error Non-AbortSignal values are rejected at runtime too.
      createCCDPClient({ oauthBridge: 'https://bridge.test', signal: {} }),
    ).rejects.toThrow('Invalid client options')
    const preAborted = new AbortController()
    preAborted.abort(new Error('Already timed out'))
    await expect(
      createCCDPClient({ oauthBridge: 'https://bridge.test', signal: preAborted.signal }),
    ).rejects.toThrow('Already timed out')
    expect(unfetched).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }

  const controller = new AbortController()
  const fetch = vi.fn(async (url: string) =>
    url === `https://bridge.test/api/v1/ceremony/config`
      ? Response.json(wireConfig)
      : Response.json({ ccdpVersions: [1], platforms: { google: [1] } }),
  )
  vi.stubGlobal('fetch', fetch)
  try {
    const client = await createCCDPClient({
      oauthBridge: 'https://bridge.test',
      signal: controller.signal,
    })
    expect(client.enabledPlatforms).toEqual(['google'])
    const init = {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    }
    expect(fetch.mock.calls).toEqual([
      ['https://bridge.test/api/v1/ceremony/config', init],
      [`https://ccdp.test${VERSIONS_PATH}`, init],
    ])
  } finally {
    vi.unstubAllGlobals()
  }

  // Aborting while Bridge config settles prevents starting the Distribution version fetch.
  const midAbort = new AbortController()
  const midFetch = vi.fn(async () => {
    midAbort.abort(new Error('Setup timed out'))
    return Response.json(wireConfig)
  })
  vi.stubGlobal('fetch', midFetch)
  try {
    await expect(
      createCCDPClient({ oauthBridge: 'https://bridge.test', signal: midAbort.signal }),
    ).rejects.toThrow('Setup timed out')
    expect(midFetch).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})
