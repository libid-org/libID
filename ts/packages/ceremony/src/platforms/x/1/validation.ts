import { PROOF_LIFETIME_SECONDS_X } from '@libid/contracts/ceremony'
import { notarizedValidation } from '../../notarized/validation.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt, identityNodes } =
  notarizedValidation(
    'x',
    // The released launch lifetime, for retention; ledger verification remains authoritative.
    PROOF_LIFETIME_SECONDS_X,
  )
