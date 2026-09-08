import { urls } from 'virtual:ceremony-assets'

export * as headers from './ccdp/headers.js'
export interface AssetRequest {
  url: string
  range?: string
  bytes?: number
  mime?: string
}
export type LocalAsset = {
  source: string
  mount: string
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
export function archive(source: string, mount: string) {
  return {
    member: (member: string, headers: LocalAsset['headers']): LocalAsset => ({
      source,
      mount,
      member,
      headers,
    }),
  }
}
/** Installed package files and standalone downloads use the same publication rules. */
export function file(source: string, mount: string, headers: LocalAsset['headers']): LocalAsset {
  return { source, mount, headers }
}
export function external(
  source: string,
  options: Omit<ExternalAsset, 'source' | 'isExternal'> = {},
): ExternalAsset {
  return { ...options, source, isExternal: true }
}
export function resolve(asset: Asset): string {
  if (asset.isExternal) return asset.source
  const path = urls[`${asset.mount}/${asset.member ?? ''}`]
  if (!path) throw new Error('Missing built asset')
  return new URL(path, location.origin).href
}
