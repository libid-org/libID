import { isFormClientId } from '../../platforms/authorization.js'
import { type PlatformId, supportedPlatforms } from '../../platforms/index.js'
import { hasExactKeys, isRecord } from '../../primitives.js'
import { origin, redirect, text, uint } from '../index.js'

export interface PlatformConfig {
  clientId: string
  ceremonyVersions: readonly number[]
}

/** Validated Bridge configuration with its registered redirect URI resolved once. */
export interface CeremonyConfig {
  redirectUri: string
  ccdpOrigin: string
  platforms: Readonly<Record<string, PlatformConfig>>
}

export const CONFIG_PATH = '/api/v1/ceremony/config'

/** Validate the Bridge wire shape, resolve callbackPath against its origin and freeze the result. */
export function validateCeremonyConfig(v: unknown, bridge: string): CeremonyConfig {
  if (
    !origin(bridge) ||
    !isRecord(v) ||
    !hasExactKeys(v, ['callbackPath', 'ccdpOrigin', 'platforms']) ||
    typeof v.callbackPath !== 'string' ||
    !v.callbackPath.startsWith('/') ||
    v.callbackPath.startsWith('//') ||
    !redirect(`${bridge}${v.callbackPath}`) ||
    !origin(v.ccdpOrigin) ||
    !isRecord(v.platforms)
  )
    throw new TypeError('Invalid Ceremony configuration')
  const platforms: Record<string, PlatformConfig> = Object.create(null)
  for (const [key, p] of Object.entries(v.platforms)) {
    if (!supportedPlatforms.includes(key as PlatformId)) continue
    if (
      !isRecord(p) ||
      !hasExactKeys(p, ['clientId', 'ceremonyVersions']) ||
      !text(p.clientId, key === 'google' ? 128 : 512) ||
      (key !== 'google' && !isFormClientId(p.clientId)) ||
      !Array.isArray(p.ceremonyVersions) ||
      !p.ceremonyVersions.length ||
      p.ceremonyVersions.some((n) => !uint(n, 65535)) ||
      new Set(p.ceremonyVersions).size !== p.ceremonyVersions.length
    )
      throw new TypeError('Invalid platform configuration')
    platforms[key] = Object.freeze({
      clientId: p.clientId,
      ceremonyVersions: Object.freeze([...p.ceremonyVersions]),
    })
  }
  return Object.freeze({
    redirectUri: `${bridge}${v.callbackPath}`,
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
