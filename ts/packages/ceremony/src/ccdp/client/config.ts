import { platforms as catalog, isPlatformId, type PlatformId } from '../../platforms/index.js'
import { hasExactKeys, isRecord, origin, uint } from '../../primitives.js'
import { readJson } from '../../response.js'
import { isClientCredential, MAX_CEREMONY_VERSION } from '../index.js'

export interface PlatformConfig {
  clientId: string
  ceremonyVersions: readonly number[]
  clientCredential?: string
}

/** Validated Bridge configuration with its registered redirect URI resolved once. */
export interface CeremonyConfig {
  redirectUri: string
  ccdpOrigin: string
  platforms: Readonly<Record<string, PlatformConfig>>
}

const CONFIG_PATH = '/api/v1/ceremony/config'

/** Public configuration is a few short records; the bound only stops unbounded reads. */
const MAX_CONFIG_BYTES = 64 * 1024

/** Validate public configuration and derive the fixed callback URL from the validated Bridge origin. */
export function validateCeremonyConfig(v: unknown, bridge: string): CeremonyConfig {
  if (
    !hasExactKeys(v, ['ccdpOrigin', 'platforms']) ||
    !origin(v.ccdpOrigin) ||
    !isRecord(v.platforms)
  )
    throw new TypeError('Invalid Ceremony configuration')
  const platforms: Record<string, PlatformConfig> = Object.create(null)
  // Platforms outside this package's closed catalog are ignored, not rejected.
  for (const [id, p] of Object.entries(v.platforms))
    if (isPlatformId(id)) platforms[id] = validatePlatformConfig(id, p)
  return Object.freeze({
    redirectUri: new URL('/auth/callback', bridge).href,
    ccdpOrigin: v.ccdpOrigin,
    platforms: Object.freeze(platforms),
  })
}

function validatePlatformConfig(id: PlatformId, p: unknown): PlatformConfig {
  if (
    !hasExactKeys(p, ['clientId', 'ceremonyVersions'], ['clientCredential']) ||
    ((catalog[id].requiresClientCredential || Object.hasOwn(p, 'clientCredential')) &&
      !isClientCredential(p.clientCredential)) ||
    !catalog[id].isClientId(p.clientId) ||
    !isVersionList(p.ceremonyVersions)
  )
    throw new TypeError('Invalid platform configuration')
  return Object.freeze({
    clientId: p.clientId,
    ceremonyVersions: Object.freeze([...p.ceremonyVersions]),
    ...(typeof p.clientCredential === 'string' ? { clientCredential: p.clientCredential } : {}),
  })
}

/** A nonempty, duplicate-free list of ceremony versions, in any order. */
function isVersionList(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((n) => uint(n, MAX_CEREMONY_VERSION)) &&
    new Set(v).size === v.length
  )
}

/** Fetch current configuration without cookies, redirects or persistent browser caching. */
export async function fetchCeremonyConfig(bridge: string): Promise<CeremonyConfig> {
  if (!origin(bridge))
    throw new TypeError('oauthBridge must be a canonical HTTPS or localhost HTTP origin')
  const response = await fetch(`${bridge}${CONFIG_PATH}`, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Configuration request failed')
  return validateCeremonyConfig(await readJson(response, MAX_CONFIG_BYTES), bridge)
}
