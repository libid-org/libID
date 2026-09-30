import { bearerLinkTypes } from '../../../barretenberg/circuits/bearer-link/types.js'
import { isUserName, provider } from './provider.js'

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkTypes(
  'x',
  isUserName,
  provider.proofLifetimeSeconds,
)
