import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { retainPrevious, swapInto } from './retention.ts'
import type { PublicRecord } from './sws.ts'

const PATH = '/ccdp/assets/policy/a.js'
const HEADERS = {
  'cache-control': 'public, max-age=60, immutable',
  'x-content-type-options': 'nosniff',
}

/** A previous output holding one published asset and the metadata that lists its policy. */
function previousOutput(body = 'old') {
  const out = mkdtempSync(join(tmpdir(), 'ceremony-retention-'))
  mkdirSync(dirname(join(out, 'public', PATH)), { recursive: true })
  writeFileSync(join(out, 'public', PATH), body)
  writeFileSync(
    join(out, 'distribution-graph.json'),
    JSON.stringify({ headers: { [PATH]: HEADERS } }),
  )
  return out
}

test('keeps a previous immutable asset with the policy it was published with [LIBID-ASSET-014]', () => {
  const out = previousOutput()
  try {
    const records = new Map<string, PublicRecord>()
    retainPrevious(out, records)
    assert.deepEqual(records.get(PATH), { bytes: Buffer.from('old'), headers: HEADERS })
    // A build that emits the same response again is not a change.
    retainPrevious(out, records)
    assert.equal(records.size, 1)
  } finally {
    rmSync(out, { recursive: true })
  }
})

test('refuses a changed body or policy at a published immutable URL [LIBID-ASSET-014]', () => {
  const out = previousOutput()
  try {
    for (const record of [
      { bytes: Buffer.from('new'), headers: HEADERS },
      { bytes: Buffer.from('old'), headers: { ...HEADERS, 'cache-control': 'no-cache' } },
    ])
      assert.throws(
        () => retainPrevious(out, new Map([[PATH, record]])),
        /Immutable response changed/,
      )
  } finally {
    rmSync(out, { recursive: true })
  }
})

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
