import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { outputDirectory, packageDir } from './sources.ts'

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
