import { proofAssets } from '../../../proving/bb/assets.js'
import { circuit, verificationKey } from '../../../proving/bb/circuits/oidc_google/assets.js'
export { circuit, verificationKey }
export const assets = [...proofAssets, circuit, verificationKey] as const
