import type { Asset } from '../assets.js'
import { assets as github } from './github/1/assets.js'
import { assets as google } from './google/1/assets.js'
import type { PlatformId, SupportedCeremonyVersion } from './index.js'
import { assets as x } from './x/1/assets.js'
export const assetsByPlatform = {
  google: { 1: google },
  x: { 1: x },
  github: { 1: github },
} as const satisfies { [P in PlatformId]: { [V in SupportedCeremonyVersion<P>]: readonly Asset[] } }

import { bearerCircuit } from '../prover/bearerLink.assets.js'
import { circuit as googleCircuit } from './google/1/assets.js'
export const circuits = [googleCircuit, bearerCircuit] as const
export { SRS_SIZE } from '../prover/bb/assets.js'
