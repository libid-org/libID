import { proofAssets } from '../../../prover/bb/assets.js'
import { bearerCircuit as circuit } from '../../../prover/bearerLink.assets.js'
import { notaryAssets } from '../../../prover/notarization/assets.js'
export { circuit }
export const assets = [...proofAssets, ...notaryAssets, circuit] as const
