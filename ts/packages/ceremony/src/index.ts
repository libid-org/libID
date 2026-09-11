export { CeremonyError, type FailureCode } from './errors.js'
export type { NotaryAttestation } from './notary/decode.js'

export {
  type Identity,
  type IdentityResult,
  type OAuthProof,
  type PlatformCeremonyVersion,
  type PlatformId,
  type ProofByPlatformVersion,
  type SupportedCeremonyVersion,
  supportedPlatforms,
} from './platforms/index.js'
