import { MAX_CEREMONY_VERSION } from '../../platforms/authorization.js'
import { isRecord, isUint } from '../../primitives.js'
import { fetchPublicJson } from '../../response.js'

/** Platform ceremony versions a Distribution bundles: platform id to its ascending version list. */
export type PlatformVersions = Readonly<Record<string, readonly number[]>>

export const VERSIONS_PATH = '/ccdp/versions.json'

/** The catalog is a short public record; bound downloads before decoding JSON. */
const MAX_VERSIONS_BYTES = 64 * 1024

/**
 * Validate the Distribution's version list. Every value is held to the grammar, a
 * platform this package does not implement included; any violation refuses the list.
 */
export function validatePlatformVersions(v: unknown): PlatformVersions {
  if (!isRecord(v)) throw new TypeError('Invalid platform versions')
  const versions: Record<string, readonly number[]> = Object.create(null)
  for (const [platform, list] of Object.entries(v)) {
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.some(
        (version, i) => !isUint(version, MAX_CEREMONY_VERSION) || (i > 0 && list[i - 1] >= version),
      )
    )
      throw new TypeError('Invalid platform versions')
    versions[platform] = Object.freeze([...list])
  }
  return Object.freeze(versions)
}

/** Fetch the configured Distribution's list without cookies, redirects or persistent browser caching. */
export async function fetchPlatformVersions(ccdpOrigin: string): Promise<PlatformVersions> {
  return validatePlatformVersions(
    await fetchPublicJson(
      `${ccdpOrigin}${VERSIONS_PATH}`,
      MAX_VERSIONS_BYTES,
      'Version list request failed',
    ),
  )
}
