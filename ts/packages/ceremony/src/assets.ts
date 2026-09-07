export interface AssetRequest {
  url: string
  range?: string
  bytes: number
  mime?: string
}
import { urls } from 'virtual:ceremony-assets'
export interface DistributedAsset {
  id: string
  mode: 'distributed'
  source: string
  sha256?: string
  bundledUrlModules?: readonly string[]
}
export interface ExternalAsset {
  id: string
  mode: 'external'
  urls: readonly string[]
  range?: string
  bytes: number
}
export type Asset = DistributedAsset | ExternalAsset
export function assetUrl(asset: DistributedAsset): string {
  const url = urls[asset.id]
  if (!url) throw new Error('Missing built asset')
  return new URL(url, location.origin).href
}
