import { bearerLinkValidation } from '../../../barretenberg/circuits/bearer-link/validation.js'
import { provider } from './provider.js'

/** The platform's longest user name, in bytes. */
export const MAX_USER_NAME_BYTES = 39

export const isUserName = (value: string): boolean =>
  value.length <= MAX_USER_NAME_BYTES &&
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(value) &&
  !value.includes('--')

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkValidation(
  'github',
  isUserName,
  provider.proofLifetimeSeconds,
)
