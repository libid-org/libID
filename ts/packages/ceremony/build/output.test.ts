import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { swapInto } from './output.ts'

test('replaces the output whole, and restores it when the replacement fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'ceremony-swap-'))
  const target = join(root, 'out')
  const staging = `${target}.building`
  try {
    mkdirSync(target)
    writeFileSync(join(target, 'kept'), 'old')
    // No staging tree: the second rename fails and the old output comes back.
    assert.throws(() => swapInto(staging, target))
    assert.equal(readFileSync(join(target, 'kept'), 'utf8'), 'old')
    assert.equal(existsSync(`${target}.previous`), false)
    mkdirSync(staging)
    writeFileSync(join(staging, 'built'), 'new')
    swapInto(staging, target)
    assert.equal(readFileSync(join(target, 'built'), 'utf8'), 'new')
    assert.equal(existsSync(join(target, 'kept')), false)
    assert.equal(existsSync(`${target}.previous`), false)
  } finally {
    rmSync(root, { recursive: true })
  }
})
