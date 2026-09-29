import { type BearerLinkProofV1, bearerLinkTypes } from '../../bearer-link/types.js'

export type XProofV1 = BearerLinkProofV1

export const isUserName = (value: string): boolean => /^[A-Za-z0-9_]{1,15}$/.test(value)

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof } = bearerLinkTypes('x', isUserName)
