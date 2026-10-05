import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { parse, type TomlTable } from 'smol-toml'
import type { DistributionMetadata } from './distribution.ts'
import { parseCsp } from './profiles.ts'
import { hash } from './sources.ts'
import { errorHeaders } from './sws.ts'
import { builtArtifacts, nativeSkip } from './testing.ts'
import { catalogVersions, proverPair, versionPairs } from './versions.ts'

const out = builtArtifacts
const metadata: DistributionMetadata = JSON.parse(
  readFileSync(join(out, 'distribution-graph.json'), 'utf8'),
)

const workerPath = Object.keys(metadata.headers).find((path) =>
  /^\/ccdp\/worker\.[a-f0-9]{64}\.js$/.test(path),
)!

test('Prefetch pins the exact immutable Worker body [TEST-DIST-08]', () => {
  assert.ok(workerPath)
  const code = readFileSync(join(out, 'public', workerPath))
  assert.equal(workerPath, `/ccdp/worker.${hash(code)}.js`)
  assert.equal(metadata.headers[workerPath]['cache-control'], 'public, max-age=31536000, immutable')
  assert.equal(metadata.headers[workerPath]['service-worker-allowed'], '/')
  const prefetch = readFileSync(join(out, 'public', metadata.files['/ccdp/v1/prefetch']), 'utf8')
  // Prefetch's entry may import an immutable chunk instead of inlining the whole bundle.
  const modules = Object.keys(metadata.files).filter(
    (path) => path.endsWith('.js') && prefetch.includes(path),
  )
  assert.ok(
    [prefetch, ...modules.map((path) => readFileSync(join(out, 'public', path), 'utf8'))].some(
      (code) => code.includes(workerPath),
    ),
  )
  assert.equal(Object.hasOwn(metadata.files, '/ccdp/v1/worker.js'), false)
})

test('static artifact has complete bodies, immutable policies, exact subsets and valid sidecars [LIBID-ASSET-001] [LIBID-ASSET-023] [LIBID-ASSET-008] [LIBID-ASSET-011] [LIBID-ASSET-012] [LIBID-PROVER-005]', () => {
  // smol-toml returns null-prototype tables; deep equality compares prototypes too.
  const config = structuredClone(parse(readFileSync(join(out, 'sws.toml'), 'utf8')))
  assert.equal((config.general as TomlTable)['text-charset'], false)
  assert.equal(Object.hasOwn(config.general as object, 'port'), false)
  assert.equal((config.general as TomlTable).health, true)
  assert.equal((config.general as TomlTable)['redirect-trailing-slash'], true)
  // The error policy catch-all first, then exactly one exact rule per file with its declared headers.
  const [first, ...exact] = (config.advanced as TomlTable).headers as {
    source: string
    headers: unknown
  }[]
  assert.deepEqual(first, { source: '/**', headers: errorHeaders })
  for (const rule of exact) assert.doesNotMatch(rule.source, /[*?[\]{}]/, rule.source)
  assert.deepEqual(
    new Map(exact.map((rule) => [rule.source, rule.headers])),
    new Map(
      Object.entries(metadata.files).map(([path, physical]) => [physical, metadata.headers[path]]),
    ),
  )
  assert.equal(exact.length, Object.keys(metadata.files).length)
  assert.deepEqual(
    metadata.headers['/404.html'],
    Object.fromEntries(
      new Headers({ 'Content-Type': 'text/html; charset=utf-8', ...errorHeaders }),
    ),
  )
  for (const [path, headers] of Object.entries(metadata.headers)) {
    const physical = metadata.files[path]
    const body = readFileSync(join(out, 'public', physical))
    for (const name of [
      'etag',
      'last-modified',
      'content-length',
      'content-encoding',
      'content-range',
    ])
      assert.equal(new Headers(headers).has(name), false)
    for (const [extension, decode] of [
      ['br', brotliDecompressSync],
      ['gz', gunzipSync],
    ] as const) {
      const sidecar = join(out, 'public', `${physical}.${extension}`)
      if (existsSync(sidecar)) assert.deepEqual(decode(readFileSync(sidecar)), body)
    }
  }
  const google = metadata.requestsByProfile['google/1']
  const x = metadata.requestsByProfile['x/1']
  const github = metadata.requestsByProfile['github/1']
  for (const [list, name] of [
    [google, 'oidc-google'],
    [x, 'bearer-link'],
    [github, 'bearer-link'],
  ] as const) {
    const keys = list.filter((r) => r.url.endsWith('/vk'))
    assert.equal(keys.length, 1)
    assert.ok(keys[0].url.endsWith(`/${name}/vk`))
    assert.equal(keys[0].bytes, 1888)
  }
  assert.deepEqual(
    x.filter((r) => r.url.endsWith('/vk')),
    github.filter((r) => r.url.endsWith('/vk')),
  )
  const wasm = google.find((r) => r.url.endsWith('/barretenberg-threads.wasm'))
  assert.ok(wasm)
  assert.equal(wasm.mime, 'application/wasm')
  for (const list of [x, github])
    assert.deepEqual(
      list.filter((r) => r.url.endsWith('/barretenberg-threads.wasm')),
      [wasm],
    )
  for (const extension of ['br', 'gz'])
    assert.ok(existsSync(join(out, 'public', `${wasm.url}.${extension}`)))
  assert.ok(!google.some((r) => r.url.includes('tlsn')))
  assert.ok(x.some((r) => r.url.endsWith('/tlsn_wasm.js')))
  // X and GitHub share one bearer-link circuit and key and one TLSN module/WASM pair.
  const bearerLink = (list: typeof x) =>
    list
      .map((r) => r.url)
      .filter((url) => /\/bearer-link\/|\/tlsn\//.test(url))
      .sort()
  assert.ok(bearerLink(x).some((url) => url.endsWith('/bearer_link.json')))
  assert.ok(bearerLink(x).some((url) => url.endsWith('/tlsn_wasm_bg.wasm')))
  assert.deepEqual(bearerLink(github), bearerLink(x))
  // Code follows the same split: a profile loads its own platform's prover only, and a profile
  // without the notary client loads none of the notary runtime.
  const modules = (list: typeof google) =>
    list.flatMap((r) => metadata.graph[r.url.slice(1)]?.modules ?? [])
  for (const [profile, list] of Object.entries(metadata.requestsByProfile))
    assert.deepEqual([...new Set(modules(list).map(proverPair).filter(Boolean))], [profile])
  assert.ok(!modules(google).some((m) => m.includes('/src/notary/session')))
  for (const list of [x, github])
    assert.ok(modules(list).some((m) => m.includes('/src/notary/session')))
  // Every profile also loads what the Prover document imports: its own code and the prover table.
  for (const list of Object.values(metadata.requestsByProfile))
    for (const source of ['/src/ccdp/documents/prover.ts', '/src/platforms/provers.ts'])
      assert.ok(
        modules(list).some((m) => m.endsWith(source)),
        source,
      )
  assert.ok(!google.some((r) => r.url.endsWith('/bearer_link.json')))
  assert.ok(!x.some((r) => r.url.endsWith('/oidc_google.json')))
  assert.deepEqual(
    x.filter((r) => r.url.startsWith('https:')),
    github.filter((r) => r.url.startsWith('https:')),
  )
  for (const list of Object.values(metadata.requestsByProfile)) {
    assert.equal(new Set(list.map((r) => `${r.url}\n${r.range ?? ''}`)).size, list.length)
    for (const request of list.filter((r) => r.url.startsWith('/')))
      assert.equal(readFileSync(join(out, 'public', request.url)).length, request.bytes)
  }
  assert.equal(existsSync(join(out, 'public/manifest.json')), false)
})

test('versions.json names the bundled platform ceremony versions, readable from any origin under the Callback cache policy [KIT-023] [LIBID-ASSET-008]', async () => {
  const path = '/ccdp/versions.json'
  const body = readFileSync(join(out, 'public', metadata.files[path]), 'utf8')
  const record = JSON.parse(body)
  assert.deepEqual(Object.keys(record).sort(), ['ccdpVersions', 'platforms'])
  assert.deepEqual(record.ccdpVersions, [1])
  const versions: Record<string, number[]> = record.platforms
  assert.equal(metadata.files[path], path)
  assert.deepEqual(metadata.headers[path], {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': metadata.headers['/ccdp/callback.html']['cache-control'],
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  })
  assert.equal(metadata.headers[path]['cache-control'], 'no-cache')
  // The wildcard is the only CORS grant of the Distribution; nothing else is read cross-origin.
  for (const [other, headers] of Object.entries(metadata.headers))
    if (other !== path)
      assert.equal(new Headers(headers).has('Access-Control-Allow-Origin'), false, other)
  assert.equal(new Headers(errorHeaders).has('Access-Control-Allow-Origin'), false)
  // Exactly the pairs the Prover bundle executes, one emitted prover chunk and one asset
  // profile each, as one compact object in catalog order.
  const prover = Object.values(metadata.graph).flatMap((node) => proverPair(node.entry) ?? [])
  assert.ok(prover.length)
  assert.deepEqual(new Set(versionPairs(versions)), new Set(prover))
  assert.deepEqual(
    new Set(versionPairs(versions)),
    new Set(Object.keys(metadata.requestsByProfile)),
  )
  assert.equal(body, JSON.stringify(record))
  // Exactly the catalog's platforms and versions, in catalog order.
  assert.deepEqual(Object.entries(versions), Object.entries(await catalogVersions()))
  for (const [platform, list] of Object.entries(versions)) {
    assert.match(platform, /^[a-z][a-z0-9-]{0,63}$/)
    assert.ok(list.length > 0, platform)
    for (const [index, version] of list.entries()) {
      assert.ok(Number.isInteger(version) && version >= 0 && version <= 65535, platform)
      if (index) assert.ok(list[index - 1] < version, platform)
    }
  }
})

test('actual SWS exact-route HTTP policies [CSP-001] [CSP-018] [TEST-DIST-01] [LIBID-ASSET-014] [KIT-023]', {
  skip: nativeSkip('CEREMONY_SWS_URL'),
}, async () => {
  for (const [path, expected] of Object.entries(metadata.headers)) {
    const physical = metadata.files[path]
    // A document's route and its physical `.html` file answer alike; nothing declared redirects.
    for (const request of new Set([path, physical])) {
      const response = await fetch(process.env.CEREMONY_SWS_URL + request, {
        headers: { 'Accept-Encoding': 'br' },
      })
      assert.equal(response.status, 200, request)
      assert.equal(response.redirected, false, request)
      for (const [key, value] of Object.entries(expected))
        assert.equal(response.headers.get(key), value, `${request} ${key}`)
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        readFileSync(join(out, 'public', physical)),
        request,
      )
    }
  }
})

test('actual SWS serves versions.json to any origin, varying on nothing but encoding [KIT-023]', {
  skip: nativeSkip('CEREMONY_SWS_URL'),
}, async () => {
  const path = '/ccdp/versions.json'
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(process.env.CEREMONY_SWS_URL + path, {
      method,
      headers: { Origin: 'https://app.test', 'Accept-Encoding': 'identity' },
    })
    assert.equal(response.status, 200, method)
    assert.equal(response.redirected, false, method)
    assert.equal(response.headers.get('access-control-allow-origin'), '*', method)
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin', method)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8', method)
    // The wildcard grant is origin-independent; only native negotiation may add a Vary.
    assert.doesNotMatch(response.headers.get('vary') ?? '', /origin/i, method)
    assert.ok(response.headers.get('etag'), method)
    const body = Buffer.from(await response.arrayBuffer())
    if (method === 'GET') assert.deepEqual(body, readFileSync(join(out, 'public', path)))
    else assert.equal(body.length, 0)
  }
})

test('actual SWS answers the health probe and serves every 404 with the error policy [KIT-001A]', {
  skip: nativeSkip('CEREMONY_SWS_URL'),
}, async () => {
  const url = process.env.CEREMONY_SWS_URL
  const health = await fetch(`${url}/health`)
  assert.equal(health.status, 200)
  // Error responses are matched on the raw request path, where only the catch-all applies: every
  // 404 carries exactly the error policy and no validator. `<file>/<name>` is the form a per-file
  // rule must never be keyed on; `/` must not serve the base image's placeholder index.
  const asset = Object.keys(metadata.headers).find((p) => /^\/ccdp\/assets\/.*\.js$/.test(p))!
  for (const path of [
    '/',
    '/nope',
    '/ccdp/v99/prover',
    '/ccdp/assets/',
    '/ccdp/assets/does/not/exist.js',
    `${asset}/${basename(asset)}`,
    '/ccdp/v1/prefetch.html/prefetch.html',
    '/ccdp/v1/prefetch/prefetch.html',
    '/ccdp/versions',
    '/ccdp/versions.json/versions.json',
    '/404.html/404.html',
  ]) {
    const missing = await fetch(url + path)
    assert.equal(missing.status, 404, path)
    assert.equal(missing.redirected, false, path)
    assert.match(missing.headers.get('content-type') ?? '', /^text\/html/, path)
    for (const [name, value] of Object.entries(errorHeaders))
      assert.equal(missing.headers.get(name), value, `${path} ${name}`)
    for (const name of ['etag', 'last-modified', 'expires', 'content-encoding'])
      assert.equal(missing.headers.get(name), null, `${path} ${name}`)
  }
  // The one redirect SWS issues: a directory path to its slash form, which is the same 404.
  const directory = await fetch(`${url}/ccdp/assets`, { redirect: 'manual' })
  assert.equal(directory.status, 308)
  assert.equal(directory.headers.get('location'), '/ccdp/assets/')
  assert.equal(directory.headers.get('cache-control'), errorHeaders['Cache-Control'])
})

test('aggregate Callback insertion preserves executable hashes and rejects malformed artifacts [KIT-009] [KIT-010] [CSP-004] [CSP-007] [TEST-DIST-02] [TEST-BRIDGE-04] [LIBID-MOD-003] [LIBID-ASSET-002]', async () => {
  const { prepareCallback } = await import('../e2e/callback.ts')
  const path = '/ccdp/callback.html'
  const html = readFileSync(join(out, 'public', path), 'utf8')
  const headers = metadata.headers[path]
  const inputs = {
    allowedApplicationOrigins: ['https://app.test', 'https://ccdp.test'],
    ccdpOrigin: 'https://ccdp.test',
  }
  const a = prepareCallback(html, headers, inputs)
  const b = prepareCallback(html, headers, {
    ...inputs,
    allowedApplicationOrigins: ['https://other.test', '</script><script>alert(1)</script>$&'],
  })
  assert.equal(a.headers['Content-Security-Policy'], b.headers['Content-Security-Policy'])
  assert.equal(a.headers['Content-Security-Policy'], headers['content-security-policy'])
  // Hostile inserted text stays data: no raw script end survives, and the policy is unchanged.
  assert.ok(b.body.includes('\\u003c/script>'))
  assert.ok(!b.body.includes('</script><script>alert(1)'))
  assert.ok(b.body.includes('$&'))
  assert.equal(a.headers['Cache-Control'], 'no-store')
  assert.equal(new Headers(a.headers).has('ETag'), false)
  assert.equal(new Headers(a.headers).has('Content-Encoding'), false)
  assert.equal(new Headers(a.headers).has('Access-Control-Allow-Origin'), false)
  assert.equal(headers['cache-control'], 'no-cache')
  for (const broken of [
    html.replace('__LIBID_CALLBACK_CONFIG__', ''),
    `${html}__LIBID_CALLBACK_CONFIG__`,
    `${html}<script src="https://evil.test"></script>`,
    html.replace('type="module">', 'type="module">void 0;'),
  ])
    assert.throws(() => prepareCallback(broken, headers, inputs))
  assert.throws(() =>
    prepareCallback(html, { ...headers, 'content-security-policy': "script-src 'self'" }, inputs),
  )
  assert.equal(Object.hasOwn(metadata.headers, '/ccdp/v1/callback.js'), false)
})

test('only worker entry scripts carry worker isolation policies, from immutable CCDP paths [LIBID-ASSET-001] [CSP-008]', () => {
  const workers = Object.entries(metadata.graph).filter(([, node]) =>
    /\.worker\.[jt]s$/.test(node.entry ?? ''),
  )
  assert.ok(workers.length > 0)
  for (const [file] of workers) {
    assert.ok(file.startsWith('ccdp/assets/'), file)
    assert.match(metadata.headers[`/${file}`]['cache-control'], /immutable/, file)
  }
  for (const [path, headers] of Object.entries(metadata.headers)) {
    const node = metadata.graph[path.slice(1)]
    // Prior immutable responses keep the policy they were published with.
    if (!path.startsWith('/ccdp/assets/') || !node) continue
    const worker = /\.worker\.[jt]s$/.test(node.entry ?? '')
    assert.equal(Object.hasOwn(headers, 'cross-origin-embedder-policy'), worker, path)
  }
})

test('CCDP contains no ledger implementation or build-time notary mapping [LIBID-ASSET-003]', () => {
  const modules = Object.values(metadata.graph).flatMap((node) => node.modules)
  assert.ok(!modules.some((path) => /\/ledger\//.test(path)))
  assert.equal(Object.hasOwn(metadata, 'ledgerFixture'), false)
  for (const [path, headers] of Object.entries(metadata.headers)) {
    const policy = headers['content-security-policy'] ?? ''
    // Prior immutable responses remain available for already-open documents.
    if (!path.startsWith('/ccdp/assets/') || Object.hasOwn(metadata.graph, path.slice(1)))
      assert.ok(!policy.includes('notary.lib.id'), path)
    if (path === '/ccdp/v1/prover' || path === '/ccdp/v1/prover/fallback') {
      const sources = parseCsp(policy).get('connect-src')!
      for (const source of ["'self'", 'https:', 'wss:', 'ws://localhost:*', 'ws://127.0.0.1:*'])
        assert.ok(sources.includes(source), path)
      assert.ok(
        !sources.some((source) => source.startsWith('http:')) && !sources.includes('ws:'),
        path,
      )
    }
  }
})

test('actual SWS negotiates representations, HEAD, conditional requests and ranges [LIBID-ASSET-026] [LIBID-ASSET-016] [KIT-001B] [KIT-023]', {
  skip: nativeSkip('CEREMONY_SWS_URL'),
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
    workerPath,
    '/ccdp/versions.json',
    metadata.requestsByProfile['google/1'].find((r) =>
      r.url.endsWith('/barretenberg-threads.wasm'),
    )!.url,
    ...Object.keys(metadata.headers)
      .filter((p) => /\.(js|wasm|json)$/.test(p) && p.startsWith('/ccdp/assets/'))
      .slice(0, 6),
  ]) {
    const original = readFileSync(join(out, 'public', metadata.files[path]))
    for (const encoding of ['identity', 'br', 'gzip']) {
      const response = await raw(path, { 'Accept-Encoding': encoding })
      assert.equal(response.status, 200)
      assert.equal(response.headers.location, undefined)
      const sidecar = join(
        out,
        'public',
        `${metadata.files[path]}.${encoding === 'br' ? 'br' : 'gz'}`,
      )
      const compressed = encoding !== 'identity' && existsSync(sidecar)
      assert.equal(response.headers['content-encoding'], compressed ? encoding : undefined)
      if (response.headers['content-length'] !== undefined)
        assert.equal(Number(response.headers['content-length']), response.body.length)
      else assert.equal(response.headers['transfer-encoding'], 'chunked')
      assert.deepEqual(
        compressed
          ? (encoding === 'br' ? brotliDecompressSync : gunzipSync)(response.body)
          : response.body,
        original,
      )
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

test('browser metadata contains resolved locations only [LIBID-MOD-021]', () => {
  for (const path of Object.keys(metadata.graph)) {
    const file = join(out, 'public', path)
    if (!existsSync(file)) continue // Embedded protocol entries have no separate script resource.
    const code = readFileSync(file, 'utf8')
    assert.doesNotMatch(code, /libid-circuits-|tlsn-wasm-|releases\/download\/|npm:@/)
  }
})
