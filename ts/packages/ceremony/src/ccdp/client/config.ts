import { platforms as catalog, isPlatformId, type PlatformId } from '../../platforms/index.js'
import { hasExactKeys, isOrigin, isRecord } from '../../primitives.js'
import { fetchPublicJson } from '../../response.js'
import { isClientCredential } from '../index.js'

/** A platform's one OAuth registration: its client ID and, where the ceremony sends one, its public credential. */
export interface PlatformConfig {
  clientId: string
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

/** Exact keys under the platform's credential rule: the credential is present iff the ceremony sends one. */
function validatePlatform(platform: PlatformId, v: unknown): PlatformConfig {
  const { requiresClientCredential, isClientId } = catalog[platform]
  if (
    !hasExactKeys(v, ['clientId', ...(requiresClientCredential ? ['clientCredential'] : [])]) ||
    !isClientId(v.clientId)
  )
    throw new TypeError('Invalid platform configuration')
  if (!requiresClientCredential) return Object.freeze({ clientId: v.clientId })
  if (!isClientCredential(v.clientCredential)) throw new TypeError('Invalid platform configuration')
  return Object.freeze({ clientId: v.clientId, clientCredential: v.clientCredential })
}

/** Validate public configuration and derive the fixed callback URL from the supplied Bridge origin. */
export function validateCeremonyConfig(v: unknown, bridge: string): CeremonyConfig {
  if (
    !hasExactKeys(v, ['ccdpOrigin', 'platforms']) ||
    !isOrigin(v.ccdpOrigin) ||
    !isRecord(v.platforms)
  )
    throw new TypeError('Invalid Ceremony configuration')
  const platforms: Record<string, PlatformConfig> = Object.create(null)
  // Platforms outside this package's closed catalog are ignored, not rejected.
  for (const [id, p] of Object.entries(v.platforms))
    if (isPlatformId(id)) platforms[id] = validatePlatform(id, p)
  return Object.freeze({
    redirectUri: new URL('/auth/callback', bridge).href,
    ccdpOrigin: v.ccdpOrigin,
    platforms: Object.freeze(platforms),
  })
}

/** Fetch current configuration without cookies, redirects or persistent browser caching. */
export async function fetchCeremonyConfig(bridge: string): Promise<CeremonyConfig> {
  if (!isOrigin(bridge))
    throw new TypeError('oauthBridge must be a canonical HTTPS or localhost HTTP origin')
  return validateCeremonyConfig(
    await fetchPublicJson(
      `${bridge}${CONFIG_PATH}`,
      MAX_CONFIG_BYTES,
      'Configuration request failed',
    ),
    bridge,
  )
}
