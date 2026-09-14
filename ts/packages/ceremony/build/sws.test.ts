import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { document } from '../src/ccdp/headers.ts'
import { cache } from './release.ts'
import { errorHeaders, writeDistribution } from './sws.ts'

// The native tests below start their own SWS on this port and the next one.
const testPort = Number(process.env.CEREMONY_SWS_TEST_PORT ?? 4687)

/** Point an emitted `sws.toml` at its own output on a loopback port. */
function localize(dir: string, port: number, edit?: (config: TomlTable) => void) {
  const path = join(dir, 'sws.toml')
  const config = parse(readFileSync(path, 'utf8'))
  Object.assign(config.general as object, {
    host: '127.0.0.1',
    port,
    root: join(dir, 'public'),
    page404: join(dir, 'public/404.html'),
  })
  edit?.(config)
  writeFileSync(path, stringify(config))
}

/** Start the pinned binary on an emitted output and wait for its health probe. */
async function serve(dir: string, port: number) {
  // A `config.toml` in the working directory would win over `--config-file`.
  const child = spawn(process.env.CEREMONY_SWS_BINARY!, ['--config-file', join(dir, 'sws.toml')], {
    cwd: dir,
    stdio: 'ignore',
  })
  let failure: Error | undefined
  child.once('error', (error) => {
    failure = error
  })
  const ended = once(child, 'exit').catch(() => undefined)
  const stop = async () => {
    child.kill()
    await ended
  }
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure
    if (child.exitCode !== null) throw new Error(`SWS exited with ${child.exitCode}`)
    try {
      if ((await fetch(`${url}/health`)).status === 200) return { url, stop }
    } catch {
      await setTimeout(50)
    }
  }
  await stop()
  throw new Error(`SWS did not answer ${url}/health`)
}

test('sidecars cannot overwrite archive members or executable resources [LIBID-ASSET-024]', () => {
  for (const extension of ['br', 'gz', 'zst'])
    assert.throws(
      () =>
        writeDistribution(
          '/unused',
          new Map([
            ['/ccdp/assets/a.js', { bytes: Buffer.from('same'.repeat(100)), headers: {} }],
            [`/ccdp/assets/a.js.${extension}`, { bytes: Buffer.from('different'), headers: {} }],
          ]),
        ),
      /sidecar/,
    )
})

test('rebuild removes obsolete compression sidecars [LIBID-ASSET-023]', () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-sidecars-'))
  const publish = (body: string) =>
    writeDistribution(
      dir,
      new Map([['/index.html', { bytes: Buffer.from(body), headers: { ...document } }]]),
    )
  try {
    publish('<p>compressible</p>'.repeat(100))
    for (const extension of ['br', 'gz'])
      assert.ok(existsSync(join(dir, `public/index.html.${extension}`)))
    publish('short')
    assert.equal(readFileSync(join(dir, 'public/index.html'), 'utf8'), 'short')
    for (const extension of ['br', 'gz'])
      assert.ok(!existsSync(join(dir, `public/index.html.${extension}`)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('emitted header rules: the error policy catch-all, then one exact rule per file; health probe on', () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-rules-'))
  try {
    const headers = { 'Cache-Control': 'public, max-age=31536000, immutable' }
    writeDistribution(
      dir,
      new Map([
        ['/ccdp/assets/a.js', { bytes: Buffer.from('a'), headers }],
        ['/ccdp/v1/prefetch', { bytes: Buffer.from('<p>p</p>'), headers: { ...document } }],
      ]),
    )
    const config = parse(readFileSync(join(dir, 'sws.toml'), 'utf8'))
    assert.equal((config.general as TomlTable).health, true)
    assert.equal((config.general as TomlTable)['security-headers'], false)
    // Plain-path matching of the rules below depends on the trailing-slash redirect staying on.
    assert.equal((config.general as TomlTable)['redirect-trailing-slash'], true)
    assert.deepEqual((config.advanced as TomlTable).rewrites, [
      { source: '/ccdp/v1/prefetch', destination: '/ccdp/v1/prefetch.html' },
    ])
    // The catch-all first, so every later exact rule overwrites it on its own file. Exact
    // physical paths only: no route (rewritten before matching) and no appended-name form
    // (`/ccdp/assets/a.js/a.js`), which is the raw path of the 404 beneath the file.
    assert.deepEqual((config.advanced as TomlTable).headers, [
      { source: '/**', headers: errorHeaders },
      { source: '/ccdp/assets/a.js', headers },
      { source: '/ccdp/v1/prefetch.html', headers: document },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('native SWS invalidates same-length rebuilt protocol bodies [LIBID-ASSET-027]', {
  skip: !process.env.CEREMONY_SWS_BINARY,
}, async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-test-'))
  const publish = (body: string) => {
    writeDistribution(
      dir,
      new Map([
        ['/ccdp/v1/prefetch', { bytes: Buffer.from(body), headers: { ...document } }],
        ['/404.html', { bytes: Buffer.from('Not found'), headers: { ...document } }],
      ]),
    )
    localize(dir, testPort)
  }
  publish('<p>first</p>')
  const server = await serve(dir, testPort)
  try {
    const url = `${server.url}/ccdp/v1/prefetch`
    const response = await fetch(url)
    assert.equal(response.status, 200)
    const etag = response.headers.get('etag')!
    assert.ok(etag.startsWith('W/'))
    assert.equal(await response.text(), '<p>first</p>')
    publish('<p>other</p>')
    const changed = await fetch(url, { headers: { 'If-None-Match': etag } })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.get('etag'), etag)
    assert.equal(await changed.text(), '<p>other</p>')
    const warm = await fetch(url, { headers: { 'If-None-Match': changed.headers.get('etag')! } })
    assert.equal(warm.status, 304)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Canary: pins how the pinned SWS matches `[[advanced.headers]]` sources (see
// sws.ts). A failure on a newer SWS means the matching changed; revisit sws.ts
// and docs/distribution.md before updating the assertions.
test('native SWS header-rule matching canary: plain path after rewrites, raw path and catch-all on errors [KIT-001A]', {
  skip: !process.env.CEREMONY_SWS_BINARY,
}, async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-canary-'))
  const port = testPort + 1
  const asset = { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Served': 'applied' }
  writeDistribution(
    dir,
    new Map([
      ['/ccdp/assets/served.js', { bytes: Buffer.from('export {}'), headers: asset }],
      ['/ccdp/v1/prefetch', { bytes: Buffer.from('<p>prefetch</p>'), headers: { ...document } }],
      ['/404.html', { bytes: Buffer.from('Not found'), headers: { ...errorHeaders } }],
    ]),
  )
  localize(dir, port, (config) => {
    const advanced = config.advanced as TomlTable
    // Probes after the emitted rules, each keyed on a form the emitted rules must not use.
    advanced.headers = [
      ...(advanced.headers as TomlTable[]),
      // The appended-name form: never a resolved file, only the raw path of the 404 beneath it.
      { source: '/ccdp/assets/served.js/served.js', headers: { 'X-Appended': 'applied' } },
      // The requested route: rewritten before matching.
      { source: '/ccdp/v1/prefetch', headers: { 'X-Requested': 'applied' } },
      // On an error, every matching rule applies in config order; later ones overwrite.
      { source: '/ccdp/assets/missing.js', headers: { 'Cache-Control': 'max-age=1' } },
    ]
  })
  const server = await serve(dir, port)
  try {
    const served = await fetch(`${server.url}/ccdp/assets/served.js`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('x-served'), 'applied')
    assert.equal(served.headers.get('x-appended'), null)
    // The exact rule overwrites the catch-all's names it declares; the others keep the catch-all's value.
    assert.equal(served.headers.get('cache-control'), asset['Cache-Control'])
    assert.equal(
      served.headers.get('content-security-policy'),
      errorHeaders['Content-Security-Policy'],
    )
    for (const path of ['/ccdp/v1/prefetch', '/ccdp/v1/prefetch.html']) {
      const page = await fetch(server.url + path)
      assert.equal(page.status, 200, path)
      assert.equal(page.redirected, false, path)
      assert.equal(page.headers.get('cache-control'), document['Cache-Control'], path)
      assert.equal(page.headers.get('x-requested'), null, path)
    }
    const beneath = await fetch(`${server.url}/ccdp/assets/served.js/served.js`)
    assert.equal(beneath.status, 404)
    assert.equal(beneath.headers.get('x-appended'), 'applied')
    assert.equal(beneath.headers.get('x-served'), null)
    assert.equal(beneath.headers.get('cache-control'), errorHeaders['Cache-Control'])
    const missing = await fetch(`${server.url}/ccdp/assets/missing.js`)
    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('cache-control'), 'max-age=1')
    // Nothing else names an unknown path: only the catch-all applies.
    const unknown = await fetch(`${server.url}/nope`)
    assert.equal(unknown.status, 404)
    for (const [name, value] of Object.entries(errorHeaders))
      assert.equal(unknown.headers.get(name), value, name)
    assert.equal(unknown.headers.get('x-served'), null)
    // The health probe answers before any header rule.
    const health = await fetch(`${server.url}/health`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), null)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
