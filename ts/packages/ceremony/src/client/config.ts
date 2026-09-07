import { isFormClientId } from '../platforms/authorization.js'
import { supportedPlatforms, type PlatformId } from '../platforms/index.js'
import { origin, redirect, text, uint } from '../ccdp/index.js'
import { hasExactKeys, isRecord } from '../primitives.js'
export interface PlatformConfig {
  clientId: string
  ceremonyVersions: readonly number[]
}
export interface CeremonyConfig {
  redirectUri: string
  ccdpOrigin: string
  platforms: Readonly<Record<string, PlatformConfig>>
}
export const CONFIG_PATH = '/api/v1/ceremony/config'
export function validateCeremonyConfig(v: unknown, bridge: string): CeremonyConfig {
  if (
    !origin(bridge) ||
    !isRecord(v) ||
    !hasExactKeys(v, ['redirectUri', 'ccdpOrigin', 'platforms']) ||
    !redirect(v.redirectUri) ||
    new URL(v.redirectUri).origin !== bridge ||
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
    redirectUri: v.redirectUri,
    ccdpOrigin: v.ccdpOrigin,
    platforms: Object.freeze(platforms),
  })
}
export async function fetchCeremonyConfig(bridge: string): Promise<CeremonyConfig> {
  if (!origin(bridge)) throw new TypeError('oauthBridge must be a canonical HTTPS origin')
  const response = await fetch(`${bridge}${CONFIG_PATH}`, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Configuration request failed')
  return validateCeremonyConfig(await response.json(), bridge)
}
