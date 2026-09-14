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
import { headerSources, writeDistribution } from './sws.ts'

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

test('emitted header rules are exact, in both matching forms, with the health probe on', () => {
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
    const rules = (config.advanced as TomlTable).headers as { source: string; headers: unknown }[]
    // Sources are globs: an exact path only, never a namespace that also matches error responses.
    for (const rule of rules) assert.doesNotMatch(rule.source, /[*?[\]{}]/, rule.source)
    assert.deepEqual(
      rules.map((rule) => rule.source),
      [...headerSources('/ccdp/assets/a.js'), ...headerSources('/ccdp/v1/prefetch.html')],
    )
    assert.deepEqual(headerSources('/ccdp/assets/a.js'), [
      '/ccdp/assets/a.js',
      '/ccdp/assets/a.js/a.js',
    ])
    for (const rule of rules.slice(0, 2)) assert.deepEqual(rule.headers, headers)
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
// headerSources in sws.ts). A failure on a newer SWS means the matching changed;
// revisit headerSources and docs/distribution.md before updating the assertions.
test('native SWS header-rule matching canary: appended file name after rewrites, raw path on errors [KIT-001A]', {
  skip: !process.env.CEREMONY_SWS_BINARY,
}, async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-canary-'))
  const port = testPort + 1
  writeDistribution(
    dir,
    new Map([
      ['/ccdp/assets/served.js', { bytes: Buffer.from('export {}'), headers: {} }],
      ['/ccdp/v1/prefetch', { bytes: Buffer.from('<p>prefetch</p>'), headers: {} }],
      ['/404.html', { bytes: Buffer.from('Not found'), headers: {} }],
    ]),
  )
  localize(dir, port, (config) => {
    ;(config.advanced as TomlTable).headers = [
      // A resolved file: the request path with its file name appended matches, the plain path does not.
      { source: '/ccdp/assets/served.js/served.js', headers: { 'X-Appended': 'applied' } },
      { source: '/ccdp/assets/served.js', headers: { 'X-Plain': 'applied' } },
      // The rewritten (physical) path is matched, not the requested route.
      { source: '/ccdp/v1/prefetch.html/prefetch.html', headers: { 'X-Rewritten': 'applied' } },
      { source: '/ccdp/v1/prefetch/prefetch.html', headers: { 'X-Requested': 'applied' } },
      // No file resolved: the raw request path matches, so a namespace wildcard would too.
      { source: '/ccdp/assets/missing.js', headers: { 'X-Error': 'applied' } },
      { source: '/ccdp/assets/**', headers: { 'X-Namespace': 'applied' } },
    ]
  })
  const server = await serve(dir, port)
  try {
    const served = await fetch(`${server.url}/ccdp/assets/served.js`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('x-appended'), 'applied')
    assert.equal(served.headers.get('x-plain'), null)
    assert.equal(served.headers.get('x-namespace'), 'applied')
    const prefetch = await fetch(`${server.url}/ccdp/v1/prefetch`)
    assert.equal(prefetch.status, 200)
    assert.equal(prefetch.headers.get('x-rewritten'), 'applied')
    assert.equal(prefetch.headers.get('x-requested'), null)
    const missing = await fetch(`${server.url}/ccdp/assets/missing.js`)
    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('x-error'), 'applied')
    assert.equal(missing.headers.get('x-namespace'), 'applied')
    assert.equal(missing.headers.get('cache-control'), null)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
