import { bearerLinkValidation } from '../../../barretenberg/circuits/bearer-link/validation.js'
import { provider } from './provider.js'

/** The platform's longest user name, in bytes. */
export const MAX_USER_NAME_BYTES = 15

export const isUserName = (value: string): boolean =>
  value.length <= MAX_USER_NAME_BYTES && /^[A-Za-z0-9_]+$/.test(value)

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkValidation(
  'x',
  isUserName,
  provider.proofLifetimeSeconds,
)
