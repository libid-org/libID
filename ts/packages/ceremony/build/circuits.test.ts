import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readArchive } from './archive.ts'
import { loadAssetCatalog } from './assets.ts'
import { validateCircuitCapacity } from './circuits.ts'

test('released circuit statistics fit the fixed launch SRS [LIBID-ASSET-013]', async () => {
  const catalog = await loadAssetCatalog()
  const releases = new Map(
    await Promise.all(
      catalog.circuits.map(
        async (asset) =>
          [
            asset.member!.replace(/\.json$/, ''),
            (await readArchive(asset.source)).get(asset.member!)!,
          ] as const,
      ),
    ),
  )
  const bearer = releases.get('bearer_link')!
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
