import type { Asset } from '../assets/index.js'
import { assets as github } from './github/1/github.assets.js'
import { assets as google } from './google/1/google.assets.js'
import type { PlatformId, SupportedCeremonyVersion } from './index.js'
import { assets as x } from './x/1/x.assets.js'
export const assetsByPlatform = {
  google: { 1: google },
  x: { 1: x },
  github: { 1: github },
} as const satisfies { [P in PlatformId]: { [V in SupportedCeremonyVersion<P>]: readonly Asset[] } }

import { bearerCircuit } from '../barretenberg/circuits/bearer_link/bearer_link.assets.js'
import { circuit as googleCircuit } from './google/1/google.assets.js'
export const circuits = [googleCircuit, bearerCircuit] as const
export { SRS_SIZE } from '../barretenberg/barretenberg.assets.js'
