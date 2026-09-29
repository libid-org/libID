import { bearerLinkTypes } from '../../bearer-types.js'

export const isUserName = (value: string): boolean => /^[A-Za-z0-9_]{1,15}$/.test(value)

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof, proofExpiresAt } = bearerLinkTypes(
  'x',
  isUserName,
)
