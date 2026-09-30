import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { test } from 'node:test'
import { executionWorker } from '../src/assets/headers.ts'
import {
  assetHeaders,
  checkDeclaredHeaders,
  externalRequest,
  loadAssetCatalog,
  resolveAssets,
} from './assets.ts'

test('asset resolution publishes only declared files and archive members [LIBID-ASSET-024]', async () => {
  const { local, urls } = await resolveAssets()
  assert.deepEqual(new Set(local.keys()), new Set(Object.values(urls)))
})

test('an installed file lives under its installed package version', async () => {
  const { urls } = await resolveAssets()
  const version = (pkg: string): string =>
    JSON.parse(readFileSync(findPackageJSON(pkg, import.meta.url)!, 'utf8')).version
  assert.equal(
    urls['noir/{version}/acvm_js_bg.wasm/'],
    `/ccdp/assets/noir/${version('@noir-lang/acvm_js')}/acvm_js_bg.wasm`,
  )
  assert.equal(
    urls['bb/{version}/wasm/barretenberg-threads.wasm/'],
    `/ccdp/assets/bb/${version('@aztec/bb.js')}/wasm/barretenberg-threads.wasm`,
  )
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

test('a retained policy is checked for form, not against the current constants', () => {
  const published = { ...assetHeaders('file.js'), 'cache-control': 'public, max-age=60, immutable' }
  assert.throws(() => assetHeaders('file.js', published), /Asset policy weakened/)
  checkDeclaredHeaders(published)
  assert.throws(() => checkDeclaredHeaders({ ETag: 'x' }))
  assert.throws(() => checkDeclaredHeaders({ 'X-A': 'a\r\nX-B: b' }))
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
