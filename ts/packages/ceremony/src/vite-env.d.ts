declare module 'virtual:ceremony-assets' {
  export const requestsByProfile: Record<
    string,
    readonly import('./assets/index.js').AssetRequest[]
  >
  export const allowedRequests: readonly import('./assets/index.js').AssetRequest[]
  export const urls: Record<string, string>
}
