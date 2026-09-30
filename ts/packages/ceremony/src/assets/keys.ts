// Keys the build and the runtime must spell identically. No imports, so build scripts load it directly.

/** A local asset's entry in the built `urls` table. */
export const assetKey = (asset: { mount: string; member?: string }) =>
  `${asset.mount}/${asset.member ?? ''}`

/** One cached fetch per URL and byte range. */
export const requestKey = (request: { url: string; range?: string }) =>
  `${request.url}\n${request.range ?? ''}`

/** A platform version's asset profile. */
export const profileKey = (platformId: string, version: number | string) =>
  `${platformId}/${version}`
