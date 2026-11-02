import { PROOF_LIFETIME_SECONDS_X } from '@libid/contracts/ceremony'
import { PLATFORM_X_KEY } from '@libid/contracts/platforms'
import { notarizedValidation } from '../../notarized/validation.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = notarizedValidation(
  PLATFORM_X_KEY,
  // The released launch lifetime, for retention; ledger verification remains authoritative.
  PROOF_LIFETIME_SECONDS_X,
)
