import { bearerLinkTypes } from '../../../barretenberg/circuits/bearer-link/types.js'
import { isUserName, profile } from './profile.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkTypes(
  'github',
  isUserName,
  profile.proofLifetimeSeconds,
)
