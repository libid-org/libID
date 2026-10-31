import { sha256 } from '@noble/hashes/sha2.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../ccdp/limits.js'
import type { IdentityNodes } from '../../identity.js'
import { bytesToBigInt, fieldHex, halves } from '../parameters.js'

/** Base64url unsigned exponent 65537, required by the oidc_google and oidc_telegram circuits. */
export const RSA_EXPONENT_BASE64URL = 'AQAB'
export const RSA_MODULUS_BYTES = 256
export const RSA_MODULUS_BITS = RSA_MODULUS_BYTES * 8
export const LIMB_BITS = 120n
export const NUM_LIMBS = Math.ceil(RSA_MODULUS_BITS / Number(LIMB_BITS))
export const BARRETT_OVERFLOW_BITS = 6n

const encoder = new TextEncoder()

/** Barrett reduction parameter for an RSA modulus, as the ABI's limbs. */
export const redc = (modulus: bigint): bigint[] =>
  limbs((1n << (2n * BigInt(RSA_MODULUS_BITS) + BARRETT_OVERFLOW_BITS)) / modulus)

/** Split an RSA integer into the ABI's least-significant-first limbs. */
export function limbs(value: bigint): bigint[] {
  const mask = (1n << LIMB_BITS) - 1n
  return Array.from(
    { length: NUM_LIMBS },
    (_, index) => (value >> (LIMB_BITS * BigInt(index))) & mask,
  )
}

/** Zero-pad a value to its fixed circuit width. */
export function pad(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length > length) throw new Error(`Value exceeds circuit limit ${length}`)
  const result = new Uint8Array(length)
  result.set(bytes)
  return result
}

/** The audience's SHA-256 as two big-endian 128-bit halves. */
export const audienceHash = (audience: Uint8Array): bigint[] => halves(sha256(audience))

export const hex = (value: bigint) => `0x${value.toString(16)}`

/** The first occurrence of a signed claim, which must follow the opening brace and end a member. */
export function findOffset(payload: Uint8Array, pattern: string): number {
  const needle = encoder.encode(pattern)
  const offset = payload.findIndex((_, start) =>
    needle.every((byte, index) => payload[start + index] === byte),
  )
  if (offset < 1)
    throw new Error(`Missing canonical signed claim ${pattern.slice(0, pattern.indexOf(':'))}`)
  const trailing = payload[offset + needle.length]
  // A comma or closing brace, kept local: importing notary/ would load it into the Google prover.
  if (trailing !== 0x2c && trailing !== 0x7d) {
    throw new Error('Signed claim lacks a structural terminator')
  }
  return offset
}

/** The exact public fields, in circuit order, for the values a proof binds (REQ-PLAT-16B). */
export function buildOidcPublicInputs(
  values: IdentityNodes & {
    authorizationDigest: Uint8Array
    audience: string
    expiresAt: number
    modulus: Uint8Array
  },
): string[] {
  if (values.authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES)
    throw new Error(`authorizationDigest must be exactly ${AUTHORIZATION_DIGEST_BYTES} bytes`)
  return [
    ...Array.from(values.authorizationDigest, fieldHex),
    ...audienceHash(encoder.encode(values.audience)).map(fieldHex),
    ...halves(values.idNode).map(fieldHex),
    ...halves(values.handleNode).map(fieldHex),
    fieldHex(values.expiresAt),
    ...limbs(bytesToBigInt(values.modulus)).map(fieldHex),
  ]
}
