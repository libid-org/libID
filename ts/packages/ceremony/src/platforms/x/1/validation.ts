import { PROOF_LIFETIME_SECONDS_X } from '@libid/contracts/ceremony'
import { notarizedValidation } from '../../notarized/validation.js'
import { decimalUserId } from '../../validation.js'

/** The platform's longest user name, in bytes. */
export const MAX_USER_NAME_BYTES = 15

export const isUserName = (value: string): boolean =>
  value.length <= MAX_USER_NAME_BYTES && /^[A-Za-z0-9_]+$/.test(value)

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = notarizedValidation(
  'x',
  { userId: decimalUserId.valid, userName: isUserName },
  // The released launch lifetime, for retention; ledger verification remains authoritative.
  PROOF_LIFETIME_SECONDS_X,
)
