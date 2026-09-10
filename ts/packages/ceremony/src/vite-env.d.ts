declare module 'virtual:ceremony-assets' {
  export const requestsByProfile: Record<string, readonly import('./assets.js').AssetRequest[]>
  export const allowedRequests: readonly import('./assets.js').AssetRequest[]
  export const urls: Record<string, string>
  export const profiles: Record<string, readonly import('./assets.js').Asset[]>
  export const local: readonly string[]
}

declare module 'virtual:ceremony-popup-fallback' {
  export const fallback: import('@libid/popup').CarrierConstructor | undefined
}
