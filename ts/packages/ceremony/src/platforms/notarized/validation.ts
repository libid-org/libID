import { MAX_CLIENT_ID_BYTES } from '../../ccdp/limits.js'
import { decodeAttestedData } from '../../notary/decode.js'
import { isFormClientId } from '../../notary/oauth/validation.js'
import type { NotaryAttestation } from '../../notary/protocol.js'
import { isNotaryAttestation } from '../../notary/protocol.js'
import { isText, recordValidator } from '../../primitives.js'
import { handleNode, type IdentityNodes, idNode, isAccountId, isHandle } from '../nodes.js'
import { type Identity, identityValidator, isProofBytes } from '../validation.js'

export interface NotarizedProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

interface NotarizedValidation<P extends string> {
  isClientId(value: unknown): value is string
  validateIdentity(value: unknown): Identity<P>
  validateProof(value: unknown): NotarizedProofV1
  proofExpiresAt(proof: NotarizedProofV1): number
  identityNodes(identity: Identity<P>): IdentityNodes
}

/**
 * Form client IDs, the platform table's id and handle checks, and the bearer-link proof. `P`
 * stays a string: the catalog derives `PlatformId` from these validators.
 */
export function notarizedValidation<P extends string>(
  platform: P,
  proofLifetimeSeconds: number,
): NotarizedValidation<P> {
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
      userId: (value) => isAccountId(platform, value),
      userName: (value) => isHandle(platform, value),
    }),
    // The proof opens the id and the handle the identity delivers (REQ-PLAT-31A).
    identityNodes: ({ userId, userName }) => ({
      idNode: idNode(platform, userId),
      handleNode: handleNode(platform, userName),
    }),
    validateProof: recordValidator<NotarizedProofV1>(`Invalid ${platform} proof`, {
      bearerLinkProof: isProofBytes,
      tokenAttestation: isNotaryAttestation,
      identityAttestation: isNotaryAttestation,
    }),
  }
}
