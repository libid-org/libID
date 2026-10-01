import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { cache, outputDirectory, packageDir, readSource } from './sources.ts'

test('a build replaces only a dedicated output directory', () => {
  for (const argument of [
    packageDir,
    join(packageDir, 'src'),
    join(packageDir, '..'),
    join(packageDir, '../../..'),
    '/tmp/ceremony-output',
  ])
    assert.throws(() => outputDirectory(argument), /dedicated directory/, argument)
  const fresh = join(packageDir, '.cache/output-directory-check')
  assert.equal(outputDirectory(fresh), fresh)
  // An interrupted build's staging or previous tree stops the next one.
  for (const leftover of [`${fresh}.building`, `${fresh}.previous`]) {
    mkdirSync(leftover, { recursive: true })
    try {
      assert.throws(() => outputDirectory(fresh), /interrupted build/)
    } finally {
      rmSync(leftover, { recursive: true })
    }
  }
})

test('an HTTPS source must match its sha256 pin, fresh or cached', async () => {
  const source = 'https://release.test/pinned.tar.gz'
  const body = Buffer.from('release bytes')
  const pin = `sha256:${createHash('sha256').update(body).digest('hex')}`
  const cached = join(cache, 'downloads', encodeURIComponent(source))
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(body))
  rmSync(cached, { force: true })
  try {
    await assert.rejects(readSource(source), /needs a sha256 pin/)
    await assert.rejects(readSource(source, 'sha256:abc'), /Invalid sha256 pin/)
    await assert.rejects(
      readSource(source, `sha256:${'0'.repeat(64)}`),
      new RegExp(`expected sha256:0{64}, got ${pin}`),
    )
    assert.equal(fetch.mock.callCount(), 1)
    // A mismatching download is never cached.
    assert.deepEqual(await readSource(source, pin), body)
    assert.deepEqual(readFileSync(cached), body)
    assert.deepEqual(await readSource(source, pin), body)
    assert.equal(fetch.mock.callCount(), 2)
    // A cached copy that no longer matches is downloaded again.
    writeFileSync(cached, 'truncated')
    assert.deepEqual(await readSource(source, pin), body)
    assert.equal(fetch.mock.callCount(), 3)
  } finally {
    fetch.mock.restore()
    rmSync(cached, { force: true })
  }
})
