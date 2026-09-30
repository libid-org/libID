import type { Asset, LocalAsset } from '../assets/index.js'
import { assets as bearerLink } from '../barretenberg/circuits/bearer-link/bearerLink.assets.js'
import { assets as google } from './google/1/google.assets.js'
import type { PlatformId, SupportedCeremonyVersion } from './index.js'

export const assetsByPlatform = {
  google: { 1: google },
  x: { 1: bearerLink },
  github: { 1: bearerLink },
} as const satisfies { [P in PlatformId]: { [V in SupportedCeremonyVersion<P>]: readonly Asset[] } }

/** Every released circuit (a JSON archive member) the build checks against the shared SRS capacity. */
export const circuits = [
  ...new Set(Object.values(assetsByPlatform).flatMap((versions) => Object.values(versions).flat())),
].filter((asset): asset is LocalAsset => !asset.isExternal && !!asset.member?.endsWith('.json'))
