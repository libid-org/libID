import type { Asset, LocalAsset } from '../assets/index.js'
import { proofAssets } from '../barretenberg/barretenberg.assets.js'
import { circuit, verificationKey } from '../barretenberg/circuits/bearer-link/bearerLink.assets.js'
import { notaryAssets } from '../notary/notary.assets.js'
import { googleAssets } from './google/1/google.assets.js'
import type { PlatformId, SupportedCeremonyVersion } from './index.js'

/** Every X/GitHub v1 resource: the proof engine, the notary client and the bearer-link circuit. */
const notarizedAssets = [...proofAssets, ...notaryAssets, circuit, verificationKey] as const

export const assetsByPlatform = {
  google: { 1: googleAssets },
  x: { 1: notarizedAssets },
  github: { 1: notarizedAssets },
} as const satisfies { [P in PlatformId]: { [V in SupportedCeremonyVersion<P>]: readonly Asset[] } }

/** Every released circuit (a JSON archive member) the build checks against the shared SRS capacity. */
export const circuits = [
  ...new Set(Object.values(assetsByPlatform).flatMap((versions) => Object.values(versions).flat())),
].filter((asset): asset is LocalAsset => !asset.isExternal && !!asset.member?.endsWith('.json'))
