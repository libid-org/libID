import { proofAssets } from '../../../prover/bb/assets.js'
import {
  bearerCircuit as circuit,
  bearerVerificationKey as verificationKey,
} from '../../../prover/bearerLink.assets.js'
import { notaryAssets } from '../../../prover/notarization/assets.js'
export { circuit, verificationKey }
export const assets = [...proofAssets, ...notaryAssets, circuit, verificationKey] as const
