import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readArchive } from './archive.ts'
import { loadAssetCatalog } from './assets.ts'
import { validateCircuitCapacity } from './circuits.ts'

test('released circuit statistics fit the SRS each circuit declares [LIBID-ASSET-013]', async () => {
  const catalog = await loadAssetCatalog()
  const releases = new Map(
    await Promise.all(
      catalog.circuits.map(
        async (asset) =>
          [
            asset.member!.replace(/\.json$/, ''),
            (await readArchive(asset.source, asset.sha256)).get(asset.member!)!,
          ] as const,
      ),
    ),
  )
  const sized = (name: string, srsPoints: number) =>
    new Map([[name, { bytes: releases.get(name)!, srsPoints }]])
  const stats = await validateCircuitCapacity(
    new Map([...sized('bearer_link', 2 ** 17), ...sized('oidc_google', 2 ** 18)]),
  )
  assert.deepEqual(stats, {
    bearer_link: { gates: 83671, dyadic: 2 ** 17 },
    oidc_google: { gates: 197462, dyadic: 2 ** 18 },
  })
  await assert.rejects(validateCircuitCapacity(sized('oidc_google', 2 ** 17)), /exceeds/)
  await assert.rejects(validateCircuitCapacity(sized('bearer_link', 2 ** 16)), /loader floor/)
})
