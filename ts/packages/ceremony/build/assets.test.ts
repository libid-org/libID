import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executionWorker } from '../src/assets/headers.ts'
import { assetHeaders, externalRequest, loadAssetCatalog, resolveAssets } from './assets.ts'

test('asset resolution publishes only declared files and archive members [LIBID-ASSET-024]', async () => {
  const { local, urls } = await resolveAssets()
  assert.deepEqual(new Set(local.keys()), new Set(Object.values(urls)))
})

test('policy cannot override server metadata or weaken immutable resources [LIBID-ASSET-026]', () => {
  for (const name of [
    'ETag',
    'Last-Modified',
    'Content-Length',
    'Content-Encoding',
    'Content-Range',
  ])
    assert.throws(() => assetHeaders('file.js', { [name]: 'x' }))
  assert.throws(() => assetHeaders('file.js', { 'Content-Type': 'a', 'content-type': 'b' }))
  assert.throws(() => assetHeaders('file.js', { 'Cache-Control': 'no-store' }))
  assert.throws(() => assetHeaders('file.wasm', { 'Content-Type': 'text/javascript' }))
  assert.throws(
    () =>
      assetHeaders('spawn.js', {
        ...executionWorker,
        'Content-Security-Policy': `SCRIPT-SRC *; ${executionWorker['Content-Security-Policy']}`,
      }),
    /Duplicate CSP directive/,
  )
  assert.equal(assetHeaders('file.wasm')['content-type'], 'application/wasm')
  assert.throws(() =>
    assetHeaders('spawn.js', {
      'Content-Security-Policy': 'default-src *; script-src *; worker-src *',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    }),
  )
})

test('external declarations retain exact URL/range and derive size without downloading [LIBID-ASSET-022]', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('Unexpected download')
  }
  try {
    assert.deepEqual(
      externalRequest({ source: 'https://cdn.test/g1', isExternal: true, range: 'bytes=0-31' }),
      { url: 'https://cdn.test/g1', range: 'bytes=0-31', bytes: 32 },
    )
    assert.throws(() => externalRequest({ source: 'http://cdn.test/x', isExternal: true }))
    assert.throws(() =>
      externalRequest({ source: 'https://cdn.test/x', isExternal: true, range: 'bytes=9-3' }),
    )
    const catalog = await loadAssetCatalog()
    assert.deepEqual(Object.keys(catalog.assetsByPlatform), ['google', 'x', 'github'])
  } finally {
    globalThis.fetch = fetch
  }
})
