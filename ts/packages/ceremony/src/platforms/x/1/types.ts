import { bearerLinkTypes } from '../../bearer-types.js'
import { isUserName, profile } from './profile.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkTypes(
  'x',
  isUserName,
  profile.proofLifetimeSeconds,
)
