import { MAX_CLIENT_ID_BYTES } from '../ccdp/limits.js'
import { decodeAttestedData, isAttestation, type NotaryAttestation } from '../notary/decode.js'
import { recordValidator, text } from '../primitives.js'
import { isFormClientId } from './authorization.js'
import { type Identity, identityValidator, isUserId, proofBytes } from './types.js'

export interface BearerLinkProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

export interface BearerLinkTypes<P extends 'x' | 'github'> {
  isClientId(value: unknown): value is string
  validateIdentity(value: unknown): Identity<P>
  validateProof(value: unknown): BearerLinkProofV1
  proofExpiresAt(proof: BearerLinkProofV1): number
}

/** X and GitHub v1 share form client IDs, decimal user IDs and the bearer-link proof. */
export function bearerLinkTypes<P extends 'x' | 'github'>(
  platform: P,
  isUserName: (value: string) => boolean,
  proofLifetimeSeconds: number,
): BearerLinkTypes<P> {
  const isClientId = (value: unknown): value is string =>
    text(value, MAX_CLIENT_ID_BYTES) && isFormClientId(value)
  return {
    isClientId,
    // Like PlatformVerifierBase._requireFresh, only the token attestation sets evidence time.
    proofExpiresAt(proof) {
      const createdAt = decodeAttestedData(proof.tokenAttestation.attestedData).createdAt
      const expiresAt = Number(createdAt) + proofLifetimeSeconds
      if (!Number.isSafeInteger(expiresAt))
        throw new RangeError('Proof expiry exceeds safe integer range')
      return expiresAt
    },
    validateIdentity: identityValidator(platform, {
      oauthClientId: isClientId,
      userId: isUserId,
      userName: isUserName,
    }),
    validateProof: recordValidator<BearerLinkProofV1>(`Invalid ${platform} proof`, {
      bearerLinkProof: proofBytes,
      tokenAttestation: isAttestation,
      identityAttestation: isAttestation,
    }),
  }
}
