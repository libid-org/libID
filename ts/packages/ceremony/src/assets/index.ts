import { urls } from 'virtual:ceremony-assets'
import { assetKey } from './keys.js'

export * as headers from './headers.js'

/** Exact fetch selected by the emitted graph; ranges distinguish requests to the same URL. */
export interface AssetRequest {
  url: string
  range?: string
  bytes?: number
  mime?: string
}

export type LocalAsset = {
  source: string
  mount: string
  /** The source's `sha256:<hex>` digest, which an HTTPS source requires. */
  sha256?: string
  member?: string
  headers: Readonly<Record<string, string>>
  bundledUrlModules?: readonly string[]
  isExternal?: false
}

export type ExternalAsset = {
  source: string
  isExternal: true
  range?: string
  bytes?: number
  fallback?: readonly string[]
}

export type Asset = LocalAsset | ExternalAsset

/**
 * Declare one archive mount, pinned to the release asset's digest as `gh release view` prints it.
 * Members select paths or wildcard matches resolved at build time.
 */
export function archive(source: string, mount: string, sha256: string) {
  return {
    member: (member: string, headers: LocalAsset['headers']): LocalAsset => ({
      source,
      mount,
      sha256,
      member,
      headers,
    }),
  }
}

/**
 * Installed package files and standalone downloads use the same publication rules. A download
 * carries its digest; the lockfile pins an installed file.
 */
export function file(
  source: string,
  mount: string,
  headers: LocalAsset['headers'],
  sha256?: string,
): LocalAsset {
  return { source, mount, headers, ...(sha256 && { sha256 }) }
}

/** Retain a native external loader URL and its request shape; the build does not rehost it. */
export function external(
  source: string,
  options: Omit<ExternalAsset, 'source' | 'isExternal'> = {},
): ExternalAsset {
  return { ...options, source, isExternal: true }
}

/** Resolve synchronously at the CCDP origin, or retain an external URL. Never fetches. */
export function assetUrl(asset: Asset): string {
  if (asset.isExternal) return asset.source
  const path = urls[assetKey(asset)]
  if (!path) throw new Error('Missing built asset')
  return new URL(path, location.origin).href
}
