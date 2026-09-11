import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import {
  bearerCircuit as circuit,
  bearerVerificationKey as verificationKey,
} from '../../../barretenberg/circuits/bearer_link/bearer_link.assets.js'
import { notaryAssets } from '../../../notary/notary.assets.js'
export { circuit, verificationKey }
export const assets = [...proofAssets, ...notaryAssets, circuit, verificationKey] as const
