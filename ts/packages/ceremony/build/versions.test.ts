import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proverPair, publishableVersions, versionPairs } from './versions.ts'

const catalog = Object.freeze({ google: [1], x: [1], github: [1] }),
  pairs = ['google/1', 'x/1', 'github/1']

test('the published list is the catalog once the platform provers and asset profiles name its pairs [KIT-023]', () => {
  assert.equal(
    publishableVersions(catalog, ['x/1', 'github/1', 'google/1'], new Set(pairs)),
    catalog,
  )
  assert.equal(
    JSON.stringify(publishableVersions(catalog, pairs, pairs)),
    '{"google":[1],"x":[1],"github":[1]}',
  )
  assert.deepEqual(versionPairs({ google: [1, 2], x: [1] }), ['google/1', 'google/2', 'x/1'])
})

test('a pair without an executable platform prover, or a prover outside the catalog and asset profiles, is never published [KIT-023]', () => {
  // A catalog entry and an asset profile for a version no bundled prover runs.
  assert.throws(
    () => publishableVersions({ ...catalog, google: [1, 2] }, pairs, [...pairs, 'google/2']),
    /^Error: Platform ceremony versions differ: google\/2 missing from platform provers$/,
  )
  // An emitted prover neither the catalog nor an asset profile names.
  assert.throws(
    () => publishableVersions(catalog, [...pairs, 'x/2'], pairs),
    /^Error: Platform ceremony versions differ: x\/2 missing from catalog, asset profiles$/,
  )
  assert.throws(
    () => publishableVersions(catalog, pairs, [...pairs, 'github/2']),
    /github\/2 missing from catalog, platform provers$/,
  )
  assert.throws(
    () => publishableVersions(catalog, ['google/1', 'x/1'], pairs),
    /github\/1 missing from platform provers$/,
  )
  assert.throws(
    () => publishableVersions({ ...catalog, google: [1, 2] }, [...pairs, 'x/2'], pairs),
    /: google\/2 missing from platform provers, asset profiles; x\/2 missing from catalog, asset profiles$/,
  )
  // A version directory the catalog cannot spell is a prover of its own, not version 1.
  assert.throws(
    () => publishableVersions(catalog, ['google/01', 'x/1', 'github/1'], pairs),
    /google\/01 missing from catalog, asset profiles; google\/1 missing from platform provers$/,
  )
})

test('an emitted chunk names its platform/version pair only when it is a prover entry', () => {
  const src = '/work/ts/packages/ceremony/src'
  assert.equal(proverPair(`${src}/platforms/google/1/prover.ts`), 'google/1')
  assert.equal(proverPair(`${src}/platforms/x/12/prover.ts`), 'x/12')
  for (const entry of [
    `${src}/platforms/google/1/oauth.ts`,
    `${src}/platforms/google/1/prover.test.ts`,
    `${src}/platforms/google/prover.ts`,
    `${src}/ccdp/documents/prover.ts`,
    '\0virtual:ceremony-entry',
    null,
  ])
    assert.equal(proverPair(entry), undefined, String(entry))
})
