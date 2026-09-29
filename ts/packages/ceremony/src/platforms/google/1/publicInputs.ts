import {
  audienceHash,
  bytesToBigInt,
  limbs,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  pack31,
  pad,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import type { Identity } from '../../types.js'
import { type GoogleProofV1, validateIdentity, validateProof } from './types.js'

const encoder = new TextEncoder()

const field = (value: bigint | number) => `0x${BigInt(value).toString(16).padStart(64, '0')}`

const packed = (value: string, width: number) =>
  pack31(pad(encoder.encode(value), width)).map(field)

/** Flatten Google v1's named proof values into the exact 56 verifier fields. */
export function buildGooglePublicInputs(
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  value: GoogleProofV1,
): string[] {
  const proof = validateProof(value)
  validateIdentity(identity)
  if (authorizationDigest.length !== 32) {
    throw new Error('authorizationDigest must be exactly 32 bytes')
  }
  return [
    ...Array.from(authorizationDigest, field),
    ...audienceHash(encoder.encode(identity.oauthClientId)).map(field),
    ...packed(identity.userId, MAX_SUB_BYTES),
    ...packed(identity.userName, MAX_EMAIL_BYTES),
    field(proof.tokenExpiresAt),
    ...limbs(bytesToBigInt(proof.signingKeyModulus)).map(field),
  ]
}

/** Exact-match bb.js output before discarding its positional array. */
export function validateGooglePublicInputs(
  value: unknown,
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  proof: GoogleProofV1,
): value is string[] {
  if (!Array.isArray(value)) return false
  const expected = buildGooglePublicInputs(authorizationDigest, identity, proof)
  return value.length === expected.length && value.every((item, index) => item === expected[index])
}
