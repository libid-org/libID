import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { DistributionMetadata } from './distribution.ts'
import { packageDir } from './release.ts'

const require = createRequire(new URL('../package.json', import.meta.url))
const graph: DistributionMetadata = JSON.parse(
  readFileSync(join(packageDir, '.cache/distribution-graph.json'), 'utf8'),
)
const requests = graph.requestsByProfile['google/1']
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
test('real dependency loaders obey emitted URLs and native CRS ranges [LIBID-ASSET-018]', async () => {
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      range = new Headers(init?.headers).get('range') ?? undefined
    const method = init?.method ?? 'GET',
      cache = init?.cache ?? 'default'
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
      ? readFileSync(join(packageDir, 'dist-artifacts/public', url))
      : new Uint8Array(spec.bytes)
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
    const bb = resolve(dirname(require.resolve('@aztec/bb.js')), '../browser')
    const { fetchCode } = await import(
      pathToFileURL(join(bb, 'barretenberg_wasm/fetch_code/browser/index.js')).href
    )
    const wasm = select('barretenberg-threads.wasm.gz').url
    assert.equal(
      WebAssembly.validate(await fetchCode(true, wasm.replace('-threads.wasm.gz', '.wasm.gz'))),
      true,
    )
    const { NetCrs, NetGrumpkinCrs } = await import(pathToFileURL(join(bb, 'crs/net_crs.js')).href)
    for (const fallback of [false, true]) {
      failPrimary = fallback
      const start = observations.length
      await new NetCrs(2 ** 18).init()
      await new NetGrumpkinCrs(2 ** 16).init()
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
