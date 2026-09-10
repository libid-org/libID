import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { brotliDecompressSync } from 'node:zlib'
import { parse, type TomlTable } from 'smol-toml'
import type { DistributionMetadata } from './distribution.ts'
import { packageDir } from './release.ts'

const out = process.env.CEREMONY_ARTIFACT_DIR ?? join(packageDir, 'dist-artifacts'),
  graph: DistributionMetadata = JSON.parse(
    readFileSync(join(out, 'distribution-graph.json'), 'utf8'),
  )
test('static artifact has complete bodies, immutable policies, exact subsets and valid sidecars [LIBID-ASSET-001] [LIBID-ASSET-023]', () => {
  const config = parse(readFileSync(join(out, 'sws.toml'), 'utf8'))
  assert.equal((config.general as TomlTable)['text-charset'], false)
  assert.equal(Object.hasOwn(config.general as object, 'port'), false)
  for (const [path, headers] of Object.entries(graph.headers)) {
    const physical = graph.files[path],
      body = readFileSync(join(out, 'public', physical))
    for (const name of [
      'etag',
      'last-modified',
      'content-length',
      'content-encoding',
      'content-range',
    ])
      assert.equal(new Headers(headers).has(name), false)
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
    const physical = graph.files[path]
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
  const a = prepareCallback(html, headers, [
    ['https://app.test', 'https://ccdp.test'],
    'https://ccdp.test',
  ])
  const b = prepareCallback(html, headers, [
    ['https://other.test', 'https://ccdp.test'],
    'https://ccdp.test',
    { hostile: '</script><script>alert(1)</script>$&' },
  ])
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
    assert.throws(() =>
      prepareCallback(broken, headers, [
        ['https://app.test', 'https://ccdp.test'],
        'https://ccdp.test',
      ]),
    )
  assert.throws(() =>
    prepareCallback(html, { ...headers, 'Content-Security-Policy': "script-src 'self'" }, [
      ['https://app.test'],
      'https://ccdp.test',
    ]),
  )
  assert.equal(Object.hasOwn(graph.headers, '/ccdp/v1/callback.js'), false)
})

test('CCDP contains no ledger implementation or build-time notary mapping [LIBID-ASSET-003]', () => {
  const modules = Object.values(graph.graph).flatMap((node) => node.modules)
  assert.ok(!modules.some((path) => /\/ledger\//.test(path)))
  assert.equal(Object.hasOwn(graph, 'ledgerFixture'), false)
  for (const [path, headers] of Object.entries(graph.headers)) {
    const policy = headers['Content-Security-Policy'] ?? ''
    // Prior immutable responses remain available for already-open documents.
    if (!path.startsWith('/ccdp/assets/') || Object.hasOwn(graph.graph, path.slice(1)))
      assert.ok(!policy.includes('notary.lib.id'), path)
    if (path === '/ccdp/v1/prover' || path === '/ccdp/v1/prover/fallback') {
      const sources = policy.split('connect-src ')[1].split(';')[0].trim().split(/\s+/)
      for (const source of [
        "'self'",
        'https:',
        'wss:',
        'http://localhost:*',
        'http://127.0.0.1:*',
        'ws://localhost:*',
        'ws://127.0.0.1:*',
      ])
        assert.ok(sources.includes(source), path)
      assert.ok(!sources.includes('http:') && !sources.includes('ws:'), path)
    }
  }
})

test('native SWS negotiates representations, HEAD, conditional requests and ranges [LIBID-ASSET-026] [LIBID-ASSET-016] [KIT-001B]', {
  skip: !process.env.CEREMONY_SWS_URL,
}, async () => {
  const { request } = await import('node:http')
  const raw = (path: string, headers: Record<string, string>, method = 'GET') =>
    new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const req = request(process.env.CEREMONY_SWS_URL + path, { headers, method }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () =>
            resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
          )
          res.on('error', reject)
        })
        req.on('error', reject)
        req.end()
      },
    )
  for (const path of [
    '/ccdp/v1/prefetch',
    '/ccdp/v1/prover',
    '/ccdp/v1/prover/fallback',
    '/ccdp/v1/worker.js',
    ...Object.keys(graph.headers)
      .filter((p) => /\.(js|wasm|json)$/.test(p) && p.startsWith('/ccdp/assets/'))
      .slice(0, 6),
  ]) {
    const original = readFileSync(join(out, 'public', graph.files[path]))
    for (const encoding of ['identity', 'br']) {
      const response = await raw(path, { 'Accept-Encoding': encoding })
      assert.equal(response.status, 200)
      assert.equal(response.headers.location, undefined)
      const sidecar = join(out, 'public', `${graph.files[path]}.br`)
      const compressed = encoding === 'br' && existsSync(sidecar)
      assert.equal(response.headers['content-encoding'], compressed ? 'br' : undefined)
      if (response.headers['content-length'] !== undefined)
        assert.equal(Number(response.headers['content-length']), response.body.length)
      else assert.equal(response.headers['transfer-encoding'], 'chunked')
      assert.deepEqual(compressed ? brotliDecompressSync(response.body) : response.body, original)
      assert.ok(response.headers.etag)
      assert.ok(response.headers['last-modified'])
      if (compressed) assert.match(String(response.headers.vary), /Accept-Encoding/i)
      const head = await raw(path, { 'Accept-Encoding': encoding }, 'HEAD')
      assert.equal(head.status, 200)
      assert.equal(head.body.length, 0)
      assert.equal(head.headers['content-length'], response.headers['content-length'])
      assert.equal(head.headers['content-encoding'], response.headers['content-encoding'])
      const conditional = await raw(path, {
        'Accept-Encoding': encoding,
        'If-None-Match': response.headers.etag!,
      })
      assert.equal(conditional.status, 304)
      assert.equal(conditional.body.length, 0)
      const range = await raw(path, { 'Accept-Encoding': encoding, Range: 'bytes=0-15' })
      assert.equal(range.status, 206)
      if (range.headers['content-length'] !== undefined)
        assert.equal(Number(range.headers['content-length']), 16)
      assert.equal(range.body.length, 16)
      assert.equal(range.headers['content-range'], `bytes 0-15/${response.body.length}`)
      assert.deepEqual(range.body, response.body.subarray(0, 16))
    }
  }
})

test('browser graph contains resolved locations only [LIBID-MOD-021]', () => {
  for (const path of Object.keys(graph.graph)) {
    const file = join(out, 'public', path)
    if (!existsSync(file)) continue // Embedded protocol entries have no separate script resource.
    const code = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      code,
      /libid-circuits-0\.3\.0|tlsn-wasm-0\.3\.0-rc\.1\.tar|npm:@noir|npm:@aztec/,
    )
  }
})
