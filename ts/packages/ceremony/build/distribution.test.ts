import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { brotliDecompressSync } from 'node:zlib'
import { parse, type TomlTable } from 'smol-toml'
import type { DistributionMetadata } from './distribution.ts'
import { hash, packageDir } from './release.ts'

const out = join(packageDir, 'dist-artifacts'),
  graph: DistributionMetadata = JSON.parse(
    readFileSync(join(packageDir, '.cache/distribution-graph.json'), 'utf8'),
  )
test('static artifact has complete bodies, immutable policies, exact subsets and valid sidecars [LIBID-ASSET-001] [LIBID-ASSET-023]', () => {
  const config = parse(readFileSync(join(out, 'sws.toml'), 'utf8'))
  assert.equal((config.general as TomlTable)['text-charset'], false)
  for (const [path, headers] of Object.entries(graph.headers)) {
    const physical = path === '/ccdp/v1/prover' ? `${path}/index.html` : path,
      body = readFileSync(join(out, 'public', physical))
    assert.equal(headers.ETag, `"${hash(body)}"`)
    if (existsSync(join(out, 'public', `${physical}.br`)))
      assert.deepEqual(
        brotliDecompressSync(readFileSync(join(out, 'public', `${physical}.br`))),
        body,
      )
  }
  const google = graph.requestsByProfile['google/1'],
    x = graph.requestsByProfile['x/1'],
    github = graph.requestsByProfile['github/1']
  assert.ok(!google.some((r) => r.url.includes('tlsn')))
  assert.ok(x.some((r) => r.url.endsWith('/tlsn_wasm.js')))
  assert.ok(!google.some((r) => r.url.endsWith('/bearer_link.json')))
  assert.ok(!x.some((r) => r.url.endsWith('/oidc_google.json')))
  assert.deepEqual(
    x.filter((r) => r.url.startsWith('https:')),
    github.filter((r) => r.url.startsWith('https:')),
  )
  for (const list of Object.values(graph.requestsByProfile)) {
    assert.equal(new Set(list.map((r) => `${r.url}\n${r.range ?? ''}`)).size, list.length)
    for (const request of list.filter((r) => r.url.startsWith('/')))
      assert.equal(readFileSync(join(out, 'public', request.url)).length, request.bytes)
  }
  assert.equal(existsSync(join(out, 'public/manifest.json')), false)
})
test('actual SWS exact-route HTTP policies [CSP-001] [CSP-018]', {
  skip: !process.env.CEREMONY_SWS_URL,
}, async () => {
  for (const [path, expected] of Object.entries(graph.headers)) {
    if (path === '/404.html') continue
    const response = await fetch(process.env.CEREMONY_SWS_URL + path, {
      headers: { 'Accept-Encoding': 'br' },
    })
    assert.equal(response.status, 200, path)
    for (const [key, value] of Object.entries(expected))
      assert.equal(response.headers.get(key), value, `${path} ${key}`)
    const physical = path === '/ccdp/v1/prover' ? `${path}/index.html` : path
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      readFileSync(join(out, 'public', physical)),
    )
  }
  assert.equal((await fetch(`${process.env.CEREMONY_SWS_URL}/ccdp/v99/prover`)).status, 404)
})

test('aggregate Callback insertion preserves executable hashes and rejects malformed artifacts [KIT-009] [KIT-010] [CSP-007]', async () => {
  const { prepareCallback } = await import('../e2e/callback.ts')
  const path = '/ccdp/callback.html'
  const html = readFileSync(join(out, 'public', path), 'utf8')
  const headers = graph.headers[path]
  const a = prepareCallback(
    html,
    headers,
    { versionedInputs: { 1: [['https://app.test'], 'https://ccdp.test'] } },
    'https://ccdp.test',
  )
  const b = prepareCallback(
    html,
    headers,
    {
      versionedInputs: { 1: [['https://other.test'], 'https://ccdp.test'] },
      hostile: '</script><script>alert(1)</script>$&',
    },
    'https://ccdp.test',
  )
  assert.equal(a.headers['Content-Security-Policy'], b.headers['Content-Security-Policy'])
  assert.ok(b.body.includes('\\u003c/script>'))
  assert.ok(b.body.includes('$&'))
  assert.equal(a.headers['Cache-Control'], 'no-store')
  assert.equal(new Headers(a.headers).has('ETag'), false)
  assert.equal(new Headers(a.headers).has('Content-Encoding'), false)
  assert.equal(new Headers(a.headers).has('Access-Control-Allow-Origin'), false)
  assert.equal(headers['Cache-Control'], 'no-cache')
  for (const broken of [
    html.replace('__LIBID_CALLBACK_CONFIG__', ''),
    `${html}__LIBID_CALLBACK_CONFIG__`,
    `${html}<script src="https://evil.test"></script>`,
    html.replace('type="module">', 'type="module">void 0;'),
  ])
    assert.throws(() => prepareCallback(broken, headers, {}, 'https://ccdp.test'))
  assert.throws(() =>
    prepareCallback(
      html,
      { ...headers, 'Content-Security-Policy': "script-src 'self'" },
      {},
      'https://ccdp.test',
    ),
  )
  assert.equal(Object.hasOwn(graph.headers, '/ccdp/v1/callback.js'), false)
})
