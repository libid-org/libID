import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import {
  circuit,
  crs,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'

export const googleAssets = [...proofAssets, ...crs, circuit, verificationKey] as const
