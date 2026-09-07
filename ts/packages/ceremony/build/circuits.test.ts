import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCircuitCapacity } from './circuits.ts'
import { circuitRelease } from './release.ts'

test('released circuit statistics fit the fixed launch SRS [LIBID-ASSET-013]', async () => {
  const bearer = await circuitRelease('bearer_link'),
    google = await circuitRelease('oidc_google')
  const releases = new Map([
    ['bearer_link', bearer],
    ['oidc_google', google],
  ])
  const stats = await validateCircuitCapacity(releases, 2 ** 18)
  assert.deepEqual(stats, {
    bearer_link: { gates: 42006, dyadic: 2 ** 16 },
    oidc_google: { gates: 179443, dyadic: 2 ** 18 },
  })
  await assert.rejects(validateCircuitCapacity(releases, 2 ** 17), /exceeds/)
  await assert.rejects(
    validateCircuitCapacity(new Map([['bearer_link', bearer]]), 2 ** 16),
    /loader floor/,
  )
  await validateCircuitCapacity(new Map([['bearer_link', bearer]]), 2 ** 17)
})
