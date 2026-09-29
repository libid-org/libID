import { type BearerLinkProofV1, bearerLinkTypes } from '../../bearer-link/types.js'

export type GitHubProofV1 = BearerLinkProofV1

export const isUserName = (value: string): boolean =>
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value) && !value.includes('--')

/** Client identifier, identity and proof constraints for this platform. */
export const { isClientId, validateIdentity, validateProof } = bearerLinkTypes('github', isUserName)
