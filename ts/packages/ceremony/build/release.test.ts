import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cache, download, hash, releaseAsset, verifyDigest } from './release.ts'

const url = 'https://github.com/libid-org/example/releases/download/v1.2.3/example-1.2.3.tar.gz'
const api = 'https://api.github.com/repos/libid-org/example/releases/tags/v1.2.3'
const bytes = Buffer.from('release bytes')
const digest = `sha256:${hash(bytes)}`

/** A fetch that answers from a table and records every call; other URLs fail like an offline host. */
function fakeFetch(responses: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input)
    calls.push({ url: target, init })
    const respond = responses[target]
    if (!respond) throw new TypeError(`fetch failed: ${target}`)
    return respond()
  }) as typeof fetch
  return { fetchImpl, calls }
}

const release = (recorded?: string | null) => () =>
  new Response(JSON.stringify({ assets: [{ name: 'example-1.2.3.tar.gz', digest: recorded }] }))
const asset = () => new Response(bytes)

function scenario(t: { after: (fn: () => void) => void }) {
  mkdirSync(cache, { recursive: true })
  const cacheDir = mkdtempSync(join(cache, 'release-test-'))
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }))
  const warnings: string[] = []
  const options = {
    cacheDir,
    warn: (message: string) => warnings.push(message),
    token: 'test-token',
  }
  return { cacheDir, warnings, options, cached: join(cacheDir, encodeURIComponent(url)) }
}

test('release asset URLs map to the release document that records their digest', () => {
  assert.deepEqual(releaseAsset(url), { api, name: 'example-1.2.3.tar.gz' })
  assert.equal(releaseAsset('https://example.com/example-1.2.3.tar.gz'), undefined)
  assert.equal(
    releaseAsset('https://github.com/libid-org/example/archive/refs/tags/v1.2.3.tar.gz'),
    undefined,
  )
})

test('digest verification accepts the recorded sha256 only', () => {
  verifyDigest(bytes, digest, url)
  assert.throws(() => verifyDigest(Buffer.from('other'), digest, url), /digest mismatch/)
  assert.throws(() => verifyDigest(bytes, `md5:${hash(bytes)}`, url), /Unsupported/)
  assert.throws(() => verifyDigest(bytes, 'sha256:short', url), /Unsupported/)
})

test('a fresh release download is verified against the GitHub digest and cached', async (t) => {
  const { warnings, options, cached } = scenario(t)
  const { fetchImpl, calls } = fakeFetch({ [api]: release(digest), [url]: asset })
  assert.deepEqual(await download(url, { ...options, fetch: fetchImpl }), bytes)
  assert.deepEqual(
    calls.map((call) => call.url),
    [api, url],
  )
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get('accept'), 'application/vnd.github+json')
  assert.equal(headers.get('authorization'), 'Bearer test-token')
  assert.deepEqual(readFileSync(cached), bytes)
  assert.deepEqual(warnings, [])
})

test('a release download whose bytes do not match the digest fails and is not cached', async (t) => {
  const { options, cached } = scenario(t)
  const { fetchImpl } = fakeFetch({
    [api]: release(`sha256:${hash('something else')}`),
    [url]: asset,
  })
  await assert.rejects(download(url, { ...options, fetch: fetchImpl }), /digest mismatch/)
  assert.equal(existsSync(cached), false)
})

test('a cached release download is verified against the digest without downloading again', async (t) => {
  const { options, cached } = scenario(t)
  writeFileSync(cached, bytes)
  const { fetchImpl, calls } = fakeFetch({ [api]: release(digest) })
  assert.deepEqual(await download(url, { ...options, fetch: fetchImpl }), bytes)
  assert.deepEqual(
    calls.map((call) => call.url),
    [api],
  )
  writeFileSync(cached, 'corrupted')
  await assert.rejects(download(url, { ...options, fetch: fetchImpl }), /digest mismatch/)
})

test('an unreachable release document warns and uses a cached download, or fails without one', async (t) => {
  const { warnings, options, cached } = scenario(t)
  const offline = fakeFetch({}).fetchImpl
  await assert.rejects(download(url, { ...options, fetch: offline }), /fetch failed/)
  writeFileSync(cached, bytes)
  assert.deepEqual(await download(url, { ...options, fetch: offline }), bytes)
  const limited = fakeFetch({ [api]: () => new Response('rate limited', { status: 403 }) })
  assert.deepEqual(await download(url, { ...options, fetch: limited.fetchImpl }), bytes)
  assert.equal(warnings.length, 2)
  for (const warning of warnings) assert.match(warning, /unavailable/)
  assert.match(warnings[1], /403/)
})

test('a release that records no digest for the asset warns and continues', async (t) => {
  const { warnings, options } = scenario(t)
  for (const recorded of [null, undefined]) {
    const { fetchImpl } = fakeFetch({ [api]: release(recorded), [url]: asset })
    assert.deepEqual(await download(url, { ...options, fetch: fetchImpl }), bytes)
  }
  const unlisted = fakeFetch({
    [api]: () => new Response(JSON.stringify({ assets: [{ name: 'other', digest }] })),
    [url]: asset,
  })
  assert.deepEqual(await download(url, { ...options, fetch: unlisted.fetchImpl }), bytes)
  assert.equal(warnings.length, 3)
  for (const warning of warnings) assert.match(warning, /No release digest/)
})

test('sources outside GitHub releases download without a digest lookup', async (t) => {
  const { warnings, options } = scenario(t)
  const plain = 'https://example.com/example-1.2.3.tar.gz'
  const { fetchImpl, calls } = fakeFetch({ [plain]: asset })
  assert.deepEqual(await download(plain, { ...options, fetch: fetchImpl }), bytes)
  assert.deepEqual(
    calls.map((call) => call.url),
    [plain],
  )
  assert.deepEqual(warnings, [])
})
