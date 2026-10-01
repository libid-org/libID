import { MAX_CLIENT_ID_BYTES } from '../../../ccdp/limits.js'
import { decodeAttestedData } from '../../../notary/decode.js'
import type { NotaryAttestation } from '../../../notary/protocol.js'
import { isNotaryAttestation } from '../../../notary/protocol.js'
import { type Identity, identityValidator, isProofBytes } from '../../../platforms/validation.js'
import { isText, recordValidator } from '../../../primitives.js'

/** X/GitHub identifiers are nonzero decimal u64 values. */
const MAX_USER_ID = 0xffffffffffffffffn
export const MAX_USER_ID_CHARS = MAX_USER_ID.toString().length

export const isUserId = (value: string): boolean =>
  value.length <= MAX_USER_ID_CHARS && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= MAX_USER_ID

/** Form-authenticated client IDs must be byte-identical under form serialization. */
export const isFormClientId = (value: string): boolean => /^[A-Za-z0-9*._-]+$/.test(value)

// A consumed redirect code that fits one header-free form field of the bounded sent transcript.
export const MAX_CODE_CHARS = 1024

/** An authorization code the token request can carry: visible ASCII within its field bound. */
export const isAuthorizationCode = (value: string): boolean =>
  value.length <= MAX_CODE_CHARS && /^[\x21-\x7e]+$/.test(value)

export interface BearerLinkProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

interface BearerLinkValidation<P extends 'x' | 'github'> {
  isClientId(value: unknown): value is string
  validateIdentity(value: unknown): Identity<P>
  validateProof(value: unknown): BearerLinkProofV1
  proofExpiresAt(proof: BearerLinkProofV1): number
}

/** X and GitHub v1 share form client IDs, decimal user IDs and the bearer-link proof. */
export function bearerLinkValidation<P extends 'x' | 'github'>(
  platform: P,
  isUserName: (value: string) => boolean,
  proofLifetimeSeconds: number,
): BearerLinkValidation<P> {
  const isClientId = (value: unknown): value is string =>
    isText(value, MAX_CLIENT_ID_BYTES) && isFormClientId(value)
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
      bearerLinkProof: isProofBytes,
      tokenAttestation: isNotaryAttestation,
      identityAttestation: isNotaryAttestation,
    }),
  }
}
