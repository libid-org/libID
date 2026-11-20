import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_telegram/oidc_telegram.assets.js'

export const telegramAssets = [...proofAssets, circuit, verificationKey] as const
