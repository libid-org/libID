import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_SIGNING_INPUT_BYTES,
  WINDOWS,
} from '../src/barretenberg/circuits/oidc_telegram/parameters.ts'
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
            (await readArchive(asset.source, asset.sha256)).get(asset.member!)!,
          ] as const,
      ),
    ),
  )
  const bearer = releases.get('bearer_link')!
  const stats = await validateCircuitCapacity(releases, 2 ** 18)
  assert.deepEqual(stats, {
    bearer_link: { gates: 83671, dyadic: 2 ** 17 },
    oidc_google: { gates: 197462, dyadic: 2 ** 18 },
    oidc_telegram: { gates: 261005, dyadic: 2 ** 18 },
  })
  await assert.rejects(validateCircuitCapacity(releases, 2 ** 17), /exceeds/)
  await assert.rejects(
    validateCircuitCapacity(new Map([['bearer_link', bearer]]), 2 ** 16),
    /loader floor/,
  )
  await validateCircuitCapacity(new Map([['bearer_link', bearer]]), 2 ** 17)
})

test('oidc_telegram parameters match the released circuit ABI', async () => {
  const catalog = await loadAssetCatalog()
  const asset = catalog.circuits.find((circuit) => circuit.member === 'oidc_telegram.json')!
  const circuit = (await readArchive(asset.source, asset.sha256)).get(asset.member!)!
  const { abi } = JSON.parse(circuit.toString('utf8')) as {
    abi: { parameters: { name: string; type: { length?: number } }[] }
  }
  const lengths = Object.fromEntries(abi.parameters.map((p) => [p.name, p.type.length]))
  assert.equal(lengths.signing_input, MAX_SIGNING_INPUT_BYTES)
  for (const [claim, width] of Object.entries(WINDOWS))
    assert.equal(lengths[`${claim}_window`], width, claim)
})
