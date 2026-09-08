import type { Identity } from '../../types.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { RSA_MODULUS_BYTES, type GoogleProofV1, validateProof, validateIdentity } from './types.js'

const encoder = new TextEncoder()

function integer(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) result = (result << 8n) | BigInt(byte)
  return result
}

const field = (value: bigint | number) => `0x${BigInt(value).toString(16).padStart(64, '0')}`

function packed(value: string, fields: number): string[] {
  const bytes = encoder.encode(value)
  const padded = new Uint8Array(fields * 31)
  padded.set(bytes)
  return Array.from({ length: fields }, (_, index) =>
    field(integer(padded.subarray(index * 31, (index + 1) * 31))),
  )
}

function modulusLimbs(modulus: Uint8Array): string[] {
  if (modulus.length !== RSA_MODULUS_BYTES) throw new Error('invalid Google signing modulus')
  const value = integer(modulus)
  const mask = (1n << 120n) - 1n
  return Array.from({ length: 18 }, (_, index) => field((value >> (120n * BigInt(index))) & mask))
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
    field(integer(audienceHash.subarray(0, 16))),
    field(integer(audienceHash.subarray(16))),
    ...packed(identity.userId, 1),
    ...packed(identity.userName, 2),
    field(proof.tokenExpiresAt),
    ...modulusLimbs(proof.signingKeyModulus),
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
