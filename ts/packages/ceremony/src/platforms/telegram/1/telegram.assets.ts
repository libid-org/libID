import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import {
  circuit,
  crs,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_telegram/oidc_telegram.assets.js'

export const telegramAssets = [...proofAssets, ...crs, circuit, verificationKey] as const
