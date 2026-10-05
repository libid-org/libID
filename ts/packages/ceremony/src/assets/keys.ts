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

/** The CCDP version this build's documents and routes implement. */
export const CCDP_VERSION = 1

/** The path prefix of this version's documents. */
export const ROUTE_SCOPE = `/ccdp/v${CCDP_VERSION}/`

/** A CCDP document route of this version. */
export const route = (name: 'prefetch' | 'prover' | 'prover/fallback') => `${ROUTE_SCOPE}${name}`

/** The path prefix of every built local asset. */
export const ASSETS_PREFIX = '/ccdp/assets/'

/** The aggregate Callback document, which serves every CCDP version. */
export const CALLBACK_PATH = '/ccdp/callback.html'

/** The Distribution's version list, one unversioned route. */
export const VERSIONS_PATH = '/ccdp/versions.json'
