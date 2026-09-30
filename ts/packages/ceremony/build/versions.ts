import { join } from 'node:path'
import type { PlatformVersions } from '../src/ccdp/client/versions.ts'
import { isUint } from '../src/primitives.ts'
import { importSource } from './bundle.ts'
import { packageDir } from './sources.ts'

/** `<platform>/<version>` for every version a list names, in the list's order. */
export function versionPairs(versions: PlatformVersions): string[] {
  return Object.entries(versions).flatMap(([platform, list]) => list.map((v) => `${platform}/${v}`))
}

/** The `<platform>/<version>` pair of an emitted `src/platforms/<platform>/<version>/prover.ts` chunk. */
export function proverPair(entry: string | null): string | undefined {
  const match =
    entry === null ? null : /\/src\/platforms\/([^/]+)\/([^/]+)\/prover\.ts$/.exec(entry)
  return match ? `${match[1]}/${match[2]}` : undefined
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

/** Read every platform's `versions` keys from the platform catalog. */
export async function catalogVersions(): Promise<PlatformVersions> {
  const { MAX_CEREMONY_VERSION } = await importSource<
    typeof import('../src/platforms/authorization.js')
  >(join(packageDir, 'src/platforms/authorization.ts'))
  const catalog = await importSource<{
    platforms: Record<string, { versions: Record<string, unknown> }>
  }>(join(packageDir, 'src/platforms/index.ts'))
  const versions: Record<string, readonly number[]> = {}
  for (const [platform, definition] of Object.entries(catalog.platforms)) {
    const list = Object.keys(definition.versions)
      .map(Number)
      .sort((a, b) => a - b)
    if (!list.length || list.some((v) => !isUint(v, MAX_CEREMONY_VERSION)))
      throw new Error(`Invalid platform ceremony versions: ${platform}`)
    versions[platform] = Object.freeze(list)
  }
  return Object.freeze(versions)
}
