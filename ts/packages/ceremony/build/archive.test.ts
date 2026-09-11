import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Header } from 'tar'
import { executionWorker } from '../src/ccdp/headers.ts'
import { readArchive, safePath, selectMember } from './archive.ts'
import { assetHeaders, externalRequest, loadAssetCatalog } from './assets.ts'
import { cache, packageDir } from './release.ts'

function tar(entries: { path: string; type?: 'File' | 'SymbolicLink' | 'Link'; body?: string }[]) {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '')
    const header = new Header({
      path: entry.path,
      type: entry.type ?? 'File',
      size: body.length,
      mode: 0o644,
      linkpath: entry.type ? '../../outside' : undefined,
    })
    header.encode()
    chunks.push(header.block!, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

test('safe archives preserve paths and wildcard selectors select exactly once [LIBID-ASSET-024] [LIBID-ASSET-025]', async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'archive-test-')),
    path = join(dir, 'bundle.tar.gz')
  try {
    writeFileSync(
      path,
      tar([
        { path: './module.js', body: 'import "./snippets/web-spawn-ab/js/spawn.js"' },
        { path: 'snippets/web-spawn-ab/js/spawn.js', body: 'export {}' },
        { path: 'unselected.json', body: '{}' },
      ]),
    )
    const files = await readArchive(path)
    assert.equal(files.size, 3)
    assert.deepEqual(await readArchive(relative(packageDir, path)), files)
    assert.equal(
      selectMember(files, 'snippets/web-spawn-*/js/spawn.js'),
      'snippets/web-spawn-ab/js/spawn.js',
    )
    assert.throws(() => selectMember(files, 'snippets/*/spawn.js'), /exactly once/)
    files.set('snippets/web-spawn-cd/js/spawn.js', Buffer.from(''))
    assert.throws(() => selectMember(files, 'snippets/web-spawn-*/js/spawn.js'), /exactly once/)
    for (const entries of [
      [{ path: '../escape' }],
      [{ path: '/absolute' }],
      [{ path: 'a', type: 'Link' as const }],
      [{ path: 'a', type: 'SymbolicLink' as const }],
      [{ path: 'a' }, { path: 'a' }],
      [{ path: 'a' }, { path: 'a/b' }],
    ]) {
      writeFileSync(path, tar(entries))
      await assert.rejects(readArchive(path))
    }
    for (const path of [
      '../a',
      '/a',
      'a/../b',
      'a?b',
      'a%2fb',
      'a\\b',
      'a//b',
      '[a].js',
      '{a,b}.js',
    ])
      assert.throws(() => safePath(path))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
