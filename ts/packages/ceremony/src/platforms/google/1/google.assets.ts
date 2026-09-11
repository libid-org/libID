import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'

export { circuit, verificationKey }

export const assets = [...proofAssets, circuit, verificationKey] as const
