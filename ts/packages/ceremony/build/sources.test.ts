import assert from 'node:assert/strict'
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
})
