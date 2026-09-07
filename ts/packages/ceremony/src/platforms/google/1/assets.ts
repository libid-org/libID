import { proofAssets } from '../../../prover/bb/assets.js'
export const circuit = {
  id: 'oidc_google',
  mode: 'distributed',
  source: 'circuit:oidc_google.json',
  sha256: '72e8a7aae1723b8611709515679890b88a24a556576c1ea8517fe5bfcd419dd2',
} as const
export const assets = [...proofAssets, circuit] as const
