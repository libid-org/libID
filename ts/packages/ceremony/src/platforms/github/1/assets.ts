import { proofAssets } from '../../../proving/bb/assets.js'
import {
  bearerCircuit as circuit,
  bearerVerificationKey as verificationKey,
} from '../../../proving/bb/circuits/bearer_link/assets.js'
import { notaryAssets } from '../../../notarization/assets.js'
export { circuit, verificationKey }
export const assets = [...proofAssets, ...notaryAssets, circuit, verificationKey] as const
