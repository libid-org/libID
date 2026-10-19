import { PROOF_LIFETIME_SECONDS_GITHUB } from '@libid/contracts/ceremony'
import { PLATFORM_GITHUB_KEY } from '@libid/contracts/platforms'
import { notarizedValidation } from '../../notarized/validation.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt, identityNodes } =
  notarizedValidation(
    PLATFORM_GITHUB_KEY,
    // The released launch lifetime, for retention; ledger verification remains authoritative.
    PROOF_LIFETIME_SECONDS_GITHUB,
  )
