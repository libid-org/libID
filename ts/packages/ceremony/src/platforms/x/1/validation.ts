import { bearerLinkValidation } from '../../../barretenberg/circuits/bearer-link/validation.js'
import { isUserName, provider } from './provider.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkValidation(
  'x',
  isUserName,
  provider.proofLifetimeSeconds,
)
