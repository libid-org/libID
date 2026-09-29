import { sha256 } from '@noble/hashes/sha2.js'
import {
  AUDIENCE_HASH_FIELD_BYTES,
  BARRETT_OVERFLOW_BITS,
  FIELD_PACK_BYTES,
  ISSUER,
  LIMB_BITS,
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_PAYLOAD_JSON_BYTES,
  MAX_SIGNING_INPUT_BYTES,
  MAX_SUB_BYTES,
  NUM_LIMBS,
  RSA_MODULUS_BITS,
} from './parameters.js'

/** Token bytes and claim values consumed by the fixed oidc_google circuit. */
export interface GoogleCircuitToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; sub: string; email: string; exp: number; nonce: string }
}

const encoder = new TextEncoder()

/** Interpret the circuit's byte arrays as unsigned big-endian integers. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

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
  if (bytes.length > length) throw new Error(`value exceeds circuit limit ${length}`)
  const result = new Uint8Array(length)
  result.set(bytes)
  return result
}

/** Pack padded bytes into big-endian FIELD_PACK_BYTES-byte field elements. */
export function pack31(bytes: Uint8Array): bigint[] {
  return Array.from({ length: Math.ceil(bytes.length / FIELD_PACK_BYTES) }, (_, index) =>
    bytesToBigInt(bytes.subarray(index * FIELD_PACK_BYTES, (index + 1) * FIELD_PACK_BYTES)),
  )
}

/** The audience's SHA-256 as two big-endian 128-bit halves. */
export function audienceHash(audience: Uint8Array): bigint[] {
  const digest = sha256(audience)
  return [
    bytesToBigInt(digest.subarray(0, AUDIENCE_HASH_FIELD_BYTES)),
    bytesToBigInt(digest.subarray(AUDIENCE_HASH_FIELD_BYTES)),
  ]
}

const hex = (value: bigint) => `0x${value.toString(16)}`

/** The first occurrence of a signed claim, which must follow the opening brace and end a member. */
function findOffset(payload: Uint8Array, pattern: string): number {
  const needle = encoder.encode(pattern)
  const offset = payload.findIndex((_, start) =>
    needle.every((byte, index) => payload[start + index] === byte),
  )
  if (offset < 1)
    throw new Error(`missing canonical signed claim ${pattern.slice(0, pattern.indexOf(':'))}`)
  const trailing = payload[offset + needle.length]
  if (trailing !== 0x2c && trailing !== 0x7d) {
    throw new Error('signed claim lacks a structural terminator')
  }
  return offset
}

/** Build the exact libid-circuits v0.4.0 `oidc_google` witness. */
export function buildGoogleInputs(
  token: GoogleCircuitToken,
  modulus: Uint8Array,
  authorizationDigest: Uint8Array,
) {
  const signingInput = encoder.encode(`${token.headerB64}.${token.payloadB64}`)
  if (signingInput.length > MAX_SIGNING_INPUT_BYTES)
    throw new Error('Google signing input is too long')
  if (token.payload.length > MAX_PAYLOAD_JSON_BYTES)
    throw new Error('Google token payload is too long')

  const { aud, sub, email, exp, nonce } = token.claims
  const emailBytes = encoder.encode(email)
  const subBytes = encoder.encode(sub)
  const audienceBytes = encoder.encode(aud)
  const paddedEmail = pad(emailBytes, MAX_EMAIL_BYTES)
  const paddedSub = pad(subBytes, MAX_SUB_BYTES)
  const expString = String(exp)
  const offset = (claim: string) => String(findOffset(token.payload, claim))
  const modulusInteger = bytesToBigInt(modulus)

  return {
    signing_input: Array.from(pad(signingInput, MAX_SIGNING_INPUT_BYTES)),
    signing_input_len: String(signingInput.length),
    header_b64_len: String(token.headerB64.length),
    payload_json: Array.from(pad(token.payload, MAX_PAYLOAD_JSON_BYTES)),
    payload_json_len: String(token.payload.length),
    email_offset: offset(`"email":"${email}"`),
    nonce_offset: offset(`"nonce":"${nonce}"`),
    sub_offset: offset(`"sub":"${sub}"`),
    email_verified_offset: offset('"email_verified":true'),
    exp_offset: offset(`"exp":${expString}`),
    exp_len: String(expString.length),
    iss_offset: offset(`"iss":"${ISSUER}"`),
    aud_offset: offset(`"aud":"${aud}"`),
    email_bytes: Array.from(paddedEmail),
    email_len: String(emailBytes.length),
    sub_bytes: Array.from(paddedSub),
    sub_len: String(subBytes.length),
    audience_bytes: Array.from(pad(audienceBytes, MAX_AUD_BYTES)),
    audience_len: String(audienceBytes.length),
    signature: limbs(bytesToBigInt(token.signature)).map(hex),
    redc: limbs(
      (1n << (2n * BigInt(RSA_MODULUS_BITS) + BARRETT_OVERFLOW_BITS)) / modulusInteger,
    ).map(hex),
    authorization_digest: Array.from(authorizationDigest),
    audience_hash: audienceHash(audienceBytes).map(hex),
    sub_packed: pack31(paddedSub).map(hex),
    email_packed: pack31(paddedEmail).map(hex),
    exp: expString,
    modulus: limbs(modulusInteger).map(hex),
  }
}

/** The oidc_google witness, keyed in the circuit's ABI order. */
export type GoogleCircuitInputs = ReturnType<typeof buildGoogleInputs>
