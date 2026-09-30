import {
  audienceHash,
  bytesToBigInt,
  limbs,
  pack31,
  pad,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import {
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { fieldHex } from '../../../barretenberg/parameters.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../authorization.js'
import type { Identity } from '../../types.js'
import type { GoogleProofV1 } from './validation.js'

const encoder = new TextEncoder()

const packed = (value: string, width: number) =>
  pack31(pad(encoder.encode(value), width)).map(fieldHex)

/** Flatten validated Google v1 identity/proof values into the exact 56 verifier fields. */
export function buildGooglePublicInputs(
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  proof: Pick<GoogleProofV1, 'tokenExpiresAt' | 'signingKeyModulus'>,
): string[] {
  if (authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES) {
    throw new Error('authorizationDigest must be exactly 32 bytes')
  }
  return [
    ...Array.from(authorizationDigest, fieldHex),
    ...audienceHash(encoder.encode(identity.oauthClientId)).map(fieldHex),
    ...packed(identity.userId, MAX_SUB_BYTES),
    ...packed(identity.userName, MAX_EMAIL_BYTES),
    fieldHex(proof.tokenExpiresAt),
    ...limbs(bytesToBigInt(proof.signingKeyModulus)).map(fieldHex),
  ]
}

/** Compare every circuit field in order; canonical hex makes string equality byte equality. */
export function isGooglePublicInputs(
  value: unknown,
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  proof: Pick<GoogleProofV1, 'tokenExpiresAt' | 'signingKeyModulus'>,
): value is string[] {
  if (!Array.isArray(value)) return false
  const expected = buildGooglePublicInputs(authorizationDigest, identity, proof)
  return value.length === expected.length && expected.every((item, index) => item === value[index])
}
