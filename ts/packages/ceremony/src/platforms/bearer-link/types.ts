import { isAttestation, type NotaryAttestation } from '../../notary/decode.js'
import { hasExactKeys, isRecord, text } from '../../primitives.js'
import { isFormClientId } from '../authorization.js'
import { type Identity, isIdentity, isUserId, proofBytes } from '../types.js'

export interface BearerLinkProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

export interface BearerLinkTypes<P extends 'x' | 'github'> {
  isClientId(value: unknown): value is string
  validateIdentity(value: unknown): Identity<P>
  validateProof(value: unknown): BearerLinkProofV1
}

/** X and GitHub v1 share form client IDs, decimal user IDs and the bearer-link proof. */
export function bearerLinkTypes<P extends 'x' | 'github'>(
  platform: P,
  isUserName: (value: string) => boolean,
): BearerLinkTypes<P> {
  const isClientId = (value: unknown): value is string => text(value, 512) && isFormClientId(value)
  return {
    isClientId,
    validateIdentity(value: unknown): Identity<P> {
      if (
        !isIdentity(value, platform, {
          oauthClientId: isClientId,
          userId: isUserId,
          userName: isUserName,
        })
      )
        throw new TypeError(`Invalid ${platform} identity`)
      return value
    },
    validateProof(v: unknown): BearerLinkProofV1 {
      if (
        !isRecord(v) ||
        !hasExactKeys(v, ['bearerLinkProof', 'tokenAttestation', 'identityAttestation']) ||
        !proofBytes(v.bearerLinkProof) ||
        !isAttestation(v.tokenAttestation) ||
        !isAttestation(v.identityAttestation)
      )
        throw new TypeError(`Invalid ${platform} proof`)
      return v as unknown as BearerLinkProofV1
    },
  }
}
