import { platforms as catalog, type PlatformId, supportedPlatforms } from '../../platforms/index.js'
import { hasExactKeys, isRecord, origin, uint } from '../../primitives.js'
import { isClientCredential } from '../index.js'

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

export const CONFIG_PATH = '/api/v1/ceremony/config'

/** Validate public configuration and derive the fixed callback URL from the supplied Bridge origin. */
export function validateCeremonyConfig(v: unknown, bridge: string): CeremonyConfig {
  if (
    !origin(bridge) ||
    !isRecord(v) ||
    !hasExactKeys(v, ['ccdpOrigin', 'platforms']) ||
    !origin(v.ccdpOrigin) ||
    !isRecord(v.platforms)
  )
    throw new TypeError('Invalid Ceremony configuration')
  const platforms: Record<string, PlatformConfig> = Object.create(null)
  for (const [key, p] of Object.entries(v.platforms)) {
    if (!supportedPlatforms.includes(key as PlatformId)) continue
    if (
      !isRecord(p) ||
      !hasExactKeys(p, [
        'clientId',
        'ceremonyVersions',
        ...(Object.hasOwn(p, 'clientCredential') ? ['clientCredential'] : []),
      ]) ||
      ((catalog[key as PlatformId].requiresClientCredential ||
        Object.hasOwn(p, 'clientCredential')) &&
        !isClientCredential(p.clientCredential)) ||
      !catalog[key as PlatformId].isClientId(p.clientId) ||
      !Array.isArray(p.ceremonyVersions) ||
      !p.ceremonyVersions.length ||
      p.ceremonyVersions.some((n) => !uint(n, 65535)) ||
      new Set(p.ceremonyVersions).size !== p.ceremonyVersions.length
    )
      throw new TypeError('Invalid platform configuration')
    platforms[key] = Object.freeze({
      clientId: p.clientId,
      ceremonyVersions: Object.freeze([...p.ceremonyVersions]),
      ...(typeof p.clientCredential === 'string' ? { clientCredential: p.clientCredential } : {}),
    })
  }
  return Object.freeze({
    redirectUri: new URL('/auth/callback', bridge).href,
    ccdpOrigin: v.ccdpOrigin,
    platforms: Object.freeze(platforms),
  })
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
  return validateCeremonyConfig(await response.json(), bridge)
}
