import { sha256 } from '@noble/hashes/sha2.js'
import {
  bytesToBigInt,
  FIELD_PACK_BYTES,
  limbs,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import type { Identity } from '../../types.js'
import { type GoogleProofV1, validateIdentity, validateProof } from './types.js'

const encoder = new TextEncoder()

const field = (value: bigint | number) => `0x${BigInt(value).toString(16).padStart(64, '0')}`

function packed(value: string, fields: number): string[] {
  const bytes = encoder.encode(value)
  const padded = new Uint8Array(fields * FIELD_PACK_BYTES)
  padded.set(bytes)
  return Array.from({ length: fields }, (_, index) =>
    field(bytesToBigInt(padded.subarray(index * FIELD_PACK_BYTES, (index + 1) * FIELD_PACK_BYTES))),
  )
}

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
  const audienceHash = sha256(encoder.encode(identity.oauthClientId))
  return [
    ...Array.from(authorizationDigest, field),
    field(bytesToBigInt(audienceHash.subarray(0, 16))),
    field(bytesToBigInt(audienceHash.subarray(16))),
    ...packed(identity.userId, 1),
    ...packed(identity.userName, 2),
    field(proof.tokenExpiresAt),
    ...limbs(bytesToBigInt(proof.signingKeyModulus)).map((limb) => field(BigInt(limb))),
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
