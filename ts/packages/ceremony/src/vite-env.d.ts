declare module 'virtual:ceremony-assets' {
  export const requestsByProfile: Record<
    string,
    readonly import('./assets/index.js').AssetRequest[]
  >
  export const allowedRequests: readonly import('./assets/index.js').AssetRequest[]
  export const urls: Record<string, string>
}

declare module 'virtual:ceremony-popup-fallback' {
  export const fallback: import('@libid/popup').CarrierConstructor | undefined
}
