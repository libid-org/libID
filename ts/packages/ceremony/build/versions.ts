import { join } from 'node:path'
import { profileKey } from '../src/assets/keys.ts'
import type { PlatformVersions } from '../src/ccdp/client/versions.ts'
import { importSource } from './bundle.ts'
import { packageDir } from './sources.ts'

/** `<platform>/<version>` for every version a list names, in the list's order. */
export function versionPairs(versions: PlatformVersions): string[] {
  return Object.entries(versions).flatMap(([platform, list]) =>
    list.map((v) => profileKey(platform, v)),
  )
}

/** The `<platform>/<version>` pair of an emitted `src/platforms/<platform>/<version>/prover.ts` chunk. */
export function proverPair(entry: string | null): string | undefined {
  const match =
    entry === null ? null : /\/src\/platforms\/([^/]+)\/([^/]+)\/prover\.ts$/.exec(entry)
  return match ? profileKey(match[1], match[2]) : undefined
}

/**
 * The version list the Distribution publishes: the catalog's, once the platform
 * provers the bundle emits and the asset profiles name exactly the catalog's pairs. The
 * client selects from this list, so a pair any of the three lacks fails the build by name.
 */
export function publishableVersions(
  catalog: PlatformVersions,
  prover: Iterable<string>,
  assets: Iterable<string>,
): PlatformVersions {
  const sources = {
    catalog: new Set(versionPairs(catalog)),
    'platform provers': new Set(prover),
    'asset profiles': new Set(assets),
  }
  const names = Object.keys(sources) as (keyof typeof sources)[]
  const differences = [...new Set(names.flatMap((name) => [...sources[name]]))]
    .sort()
    .filter((pair) => names.some((name) => !sources[name].has(pair)))
    .map(
      (pair) =>
        `${pair} missing from ${names.filter((name) => !sources[name].has(pair)).join(', ')}`,
    )
  if (differences.length)
    throw new Error(`Platform ceremony versions differ: ${differences.join('; ')}`)
  return catalog
}

/** The platform catalog's versions, held to the grammar the client reads `versions.json` under. */
export async function catalogVersions(): Promise<PlatformVersions> {
  const [{ platforms }, { validatePlatformVersions }] = await Promise.all([
    importSource<{ platforms: Record<string, { versions: Record<string, unknown> }> }>(
      join(packageDir, 'src/platforms/index.ts'),
    ),
    importSource<typeof import('../src/ccdp/client/versions.ts')>(
      join(packageDir, 'src/ccdp/client/versions.ts'),
    ),
  ])
  return validatePlatformVersions(
    Object.fromEntries(
      Object.entries(platforms).map(([platform, { versions }]) => [
        platform,
        Object.keys(versions)
          .map(Number)
          .sort((a, b) => a - b),
      ]),
    ),
  )
}
