declare module 'virtual:ceremony-assets' {
  export const requestsByProfile: Record<
    string,
    readonly import('./assets/index.js').AssetRequest[]
  >
  export const allowedRequests: readonly import('./assets/index.js').AssetRequest[]
  export const supportedProfiles: readonly string[]
  export const urls: Record<string, string>
}

declare module 'virtual:ceremony-worker' {
  export const rootWorkerUrl: string
}
