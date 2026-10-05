import { expect, it } from 'vitest'
import { proverFor, provers } from './provers.js'

// The table's shape is typed against the catalog; conformance checks each loader's prover.
it('selects the loader the table holds for every bundled pair [KIT-023]', () => {
  for (const [platform, versions] of Object.entries(provers))
    for (const [version, load] of Object.entries(versions))
      expect(proverFor(platform, Number(version))).toEqual({
        platformId: platform,
        version: Number(version),
        load,
      })
})

it.each([
  ['google', 2],
  ['google', 0],
  ['google', 1.5],
  ['google', Number.NaN],
  ['future', 1],
  ['constructor', 1],
  ['__proto__', 1],
  ['toString', 1],
])('selects nothing for %s/%s, which no bundled prover serves [KIT-023]', (platform, version) => {
  expect(proverFor(platform, version)).toBeUndefined()
})
