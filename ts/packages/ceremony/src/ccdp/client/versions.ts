import { CCDP_VERSION, VERSIONS_PATH } from '../../assets/keys.js'
import { hasExactKeys, isRecord, isUint } from '../../primitives.js'
import { fetchPublicJson } from '../../response.js'
import { MAX_CEREMONY_VERSION } from '../limits.js'

/** Platform ceremony versions a Distribution bundles: platform id to its ascending version list. */
export type PlatformVersions = Readonly<Record<string, readonly number[]>>

/** Protocol versions and the platform profiles shared by every included protocol version. */
export interface DistributionVersions {
  readonly ccdpVersions: readonly number[]
  readonly platforms: PlatformVersions
}

/** The version list is a short public record; bound downloads before decoding JSON. */
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

/** Validate the entire public record before ignoring any unsupported platform or version. */
export function validateDistributionVersions(value: unknown): DistributionVersions {
  if (
    !hasExactKeys(value, ['ccdpVersions', 'platforms']) ||
    !Array.isArray(value.ccdpVersions) ||
    !value.ccdpVersions.length ||
    value.ccdpVersions.some(
      (version, i, list) =>
        !isUint(version, Number.MAX_SAFE_INTEGER) ||
        version === 0 ||
        (i > 0 && list[i - 1] >= version),
    )
  )
    throw new TypeError('Invalid Distribution versions')
  return Object.freeze({
    ccdpVersions: Object.freeze([...value.ccdpVersions]),
    platforms: validatePlatformVersions(value.platforms),
  })
}

/** Fetch and validate the list, refusing an unavailable CCDP version before any ceremony can launch. */
export async function fetchPlatformVersions(ccdpOrigin: string): Promise<PlatformVersions> {
  const versions = validateDistributionVersions(
    await fetchPublicJson(
      `${ccdpOrigin}${VERSIONS_PATH}`,
      MAX_VERSIONS_BYTES,
      'Version list request failed',
    ),
  )
  if (!versions.ccdpVersions.includes(CCDP_VERSION))
    throw new Error('Distribution does not support this CCDP version')
  return versions.platforms
}
