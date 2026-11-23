import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import type { DistributionMetadata } from './distribution.ts'
import { builtArtifacts } from './testing.ts'

const require = createRequire(new URL('../package.json', import.meta.url))

const out = builtArtifacts

const metadata: DistributionMetadata = JSON.parse(
  readFileSync(join(out, 'distribution-graph.json'), 'utf8'),
)

const requests = metadata.requestsByProfile['google/1']

const originalFetch = globalThis.fetch

const observations: { url: string; range?: string; method: string; cache: RequestCache }[] = []

let failPrimary = false

const select = (name: string) => {
  const request = requests.find((r) => r.url.endsWith(`/${name}`))
  assert.ok(request, `Missing ${name}`)
  return request
}

const external = requests.filter((r) => r.url.startsWith('https:'))

// These observing stubs never contact external hosts. They test the dependency
// loaders, not proving: only the standalone browser qualification uses real CRS.
test('real dependency loaders obey emitted URLs and native CRS ranges [LIBID-ASSET-018] [TEST-DIST-04] [LIBID-ASSET-011]', async () => {
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const range = new Headers(init?.headers).get('range') ?? undefined
    const method = init?.method ?? 'GET'
    const cache = init?.cache ?? 'default'
    observations.push({ url, range, method, cache })
    assert.equal(method, 'GET')
    assert.equal(cache, url.startsWith('https:') ? 'force-cache' : 'default')
    const spec =
      requests.find((r) => r.url === url && r.range === range) ??
      external.find(
        (r) =>
          new URL(r.url).pathname === new URL(url).pathname &&
          r.range === range &&
          new URL(url).origin === 'https://crs.aztec-labs.com',
      )
    assert.ok(spec, `undeclared dependency request: ${url} ${range}`)
    if (failPrimary && url.startsWith('https://crs.aztec-cdn.foundation'))
      throw new Error('Primary intentionally blocked')
    const body = url.startsWith('/')
      ? readFileSync(join(out, 'public', url))
      : new Uint8Array(spec.bytes!)
    return new Response(body, {
      status: range ? 206 : 200,
      headers: { 'Content-Type': spec.mime ?? 'application/octet-stream' },
    })
  }
  try {
    for (const [pkg, file, wasm] of [
      ['@noir-lang/acvm_js', 'acvm_js.js', 'acvm_js_bg.wasm'],
      ['@noir-lang/noirc_abi', 'noirc_abi_wasm.js', 'noirc_abi_wasm_bg.wasm'],
    ]) {
      const module: typeof import('@noir-lang/acvm_js') | typeof import('@noir-lang/noirc_abi') =
        await import(pathToFileURL(resolve(dirname(require.resolve(pkg)), '../web', file)).href)
      await module.default({ module_or_path: select(wasm).url })
    }
    const bb = resolve(dirname(require.resolve('@aztec-foundation/bb.js')), '../browser')
    const { fetchCode } = await import(
      pathToFileURL(join(bb, 'barretenberg_wasm/fetch_code/browser/index.js')).href
    )
    const wasm = select('barretenberg-threads.wasm').url
    // The emitted body is already decoded; bb must not need its JS gzip branch.
    assert.deepEqual(
      readFileSync(join(out, 'public', wasm)),
      gunzipSync(readFileSync(join(bb, '../node/barretenberg_wasm/barretenberg-threads.wasm.gz'))),
    )
    assert.equal(
      WebAssembly.validate(await fetchCode(true, wasm.replace('-threads.wasm', '.wasm'))),
      true,
    )
    const { NetCrs } = await import(pathToFileURL(join(bb, 'crs/net_crs.js')).href)
    // The engine already passes crsPath (LIBID-ASSET-022); pinned bb.js browser loaders take only
    // a point count. When this fails, bb.js honors a CRS base: observe the engine's base here and
    // revisit distributed CRS.
    const { Crs } = await import(pathToFileURL(join(bb, 'crs/browser/index.js')).href)
    assert.match(String(Crs.new), /^async new\(numPoints\)/)
    // The engine repeats bb.js's BN254 SRS setup without its Grumpkin half; when this fails,
    // bb.js changed that setup: carry the change into the engine's bn254Backend.
    const { Barretenberg } = await import(pathToFileURL(join(bb, 'barretenberg/index.js')).href)
    assert.match(
      String(Barretenberg.prototype.initSRSChonk).replace(/\s+/g, ' '),
      /const crs = await Crs\.new\(srsSize, this\.options\.crsPath, this\.options\.logger\);.*await this\.srsInitSrs\(\{ pointsBuf: crs\.getG1Data\(\), numPoints: crs\.numPoints, g2Point: crs\.getG2Data\(\), \}\); if \(response\.pointsBuf\.length > 0\) \{ await crs\.cacheUncompressed\(response\.pointsBuf\); \}/,
    )
    for (const fallback of [false, true]) {
      failPrimary = fallback
      const start = observations.length
      await new NetCrs(2 ** 18).init()
      const actual = observations.slice(start)
      for (const spec of external) {
        assert.ok(actual.some((r) => r.url === spec.url && r.range === spec.range))
        if (fallback) {
          assert.ok(
            actual.some(
              (r) =>
                r.url === spec.url.replace('crs.aztec-cdn.foundation', 'crs.aztec-labs.com') &&
                r.range === spec.range,
            ),
          )
          assert.ok(
            actual.findIndex((r) => r.url === spec.url) <
              actual.findIndex(
                (r) => r.url === spec.url.replace('crs.aztec-cdn.foundation', 'crs.aztec-labs.com'),
              ),
          )
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
