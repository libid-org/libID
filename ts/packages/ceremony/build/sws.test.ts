import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { parse, stringify } from 'smol-toml'
import { document } from '../src/ccdp/headers.ts'
import { cache } from './release.ts'
import { writeDistribution } from './sws.ts'

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

test('native SWS invalidates same-length rebuilt protocol bodies [LIBID-ASSET-027]', {
  skip: !process.env.CEREMONY_SWS_BINARY,
}, async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'sws-test-'))
  const port = Number(process.env.CEREMONY_SWS_TEST_PORT ?? 4687)
  const publish = (body: string) => {
    writeDistribution(
      dir,
      new Map([
        ['/ccdp/v1/prefetch', { bytes: Buffer.from(body), headers: { ...document } }],
        ['/404.html', { bytes: Buffer.from('Not found'), headers: { ...document } }],
      ]),
    )
    const path = join(dir, 'sws.toml')
    const config = parse(readFileSync(path, 'utf8'))
    Object.assign(config.general as object, {
      host: '127.0.0.1',
      port,
      root: join(dir, 'public'),
      page404: join(dir, 'public/404.html'),
    })
    writeFileSync(path, stringify(config))
  }
  publish('<p>first</p>')
  const child = spawn(process.env.CEREMONY_SWS_BINARY!, ['--config-file', join(dir, 'sws.toml')], {
    stdio: 'ignore',
  })
  const ended = once(child, 'exit')
  try {
    const url = `http://127.0.0.1:${port}/ccdp/v1/prefetch`
    let response: Response | undefined
    for (let i = 0; i < 50; i++) {
      try {
        response = await fetch(url)
        break
      } catch {
        await setTimeout(20)
      }
    }
    assert.equal(response?.status, 200)
    const etag = response!.headers.get('etag')!
    assert.ok(etag.startsWith('W/'))
    assert.equal(await response!.text(), '<p>first</p>')
    publish('<p>other</p>')
    const changed = await fetch(url, { headers: { 'If-None-Match': etag } })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.get('etag'), etag)
    assert.equal(await changed.text(), '<p>other</p>')
    const warm = await fetch(url, { headers: { 'If-None-Match': changed.headers.get('etag')! } })
    assert.equal(warm.status, 304)
  } finally {
    child.kill()
    await ended
    rmSync(dir, { recursive: true, force: true })
  }
})
