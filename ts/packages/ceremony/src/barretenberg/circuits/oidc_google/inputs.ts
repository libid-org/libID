import { sha256 } from '@noble/hashes/sha2.js'
export const FIELD_PACK_BYTES = 31

export const MAX_EMAIL_BYTES = 62,
  MAX_SUB_BYTES = 31,
  MAX_AUD_BYTES = 128,
  RSA_MODULUS_BYTES = 256

/** Token bytes and claim values consumed by the fixed oidc_google circuit. */
export interface GoogleCircuitToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; sub: string; email: string; exp: number; nonce: string }
}

const SIGNING_INPUT_MAX = 1280

const PAYLOAD_JSON_MAX = 768

const NUM_LIMBS = 18

const LIMB_BITS = 120n

const BARRETT_OVERFLOW_BITS = 6n

const encoder = new TextEncoder()

export interface GoogleCircuitInputs extends Record<string, unknown> {
  signing_input: number[]
  signing_input_len: string
  header_b64_len: string
  payload_json: number[]
  payload_json_len: string
  email_offset: string
  nonce_offset: string
  sub_offset: string
  email_verified_offset: string
  exp_offset: string
  exp_len: string
  iss_offset: string
  aud_offset: string
  email_bytes: number[]
  email_len: string
  sub_bytes: number[]
  sub_len: string
  audience_bytes: number[]
  audience_len: string
  signature: string[]
  redc: string[]
  authorization_digest: number[]
  audience_hash: string[]
  sub_packed: string[]
  email_packed: string[]
  exp: string
  modulus: string[]
}

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
  return [bytesToBigInt(digest.subarray(0, 16)), bytesToBigInt(digest.subarray(16))]
}

const hex = (value: bigint) => `0x${value.toString(16)}`

function findOffset(payload: Uint8Array, pattern: string): number {
  const needle = encoder.encode(pattern)
  outer: for (let offset = 0; offset + needle.length <= payload.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (payload[offset + index] !== needle[index]) continue outer
    }
    if (offset < 1) break
    const trailing = payload[offset + needle.length]
    if (trailing !== 0x2c && trailing !== 0x7d) {
      throw new Error('signed claim lacks a structural terminator')
    }
    return offset
  }
  throw new Error(`missing canonical signed claim ${pattern.slice(0, pattern.indexOf(':'))}`)
}

/** Build the exact libid-circuits v0.4.0 `oidc_google` witness. */
export function buildGoogleInputs(
  token: GoogleCircuitToken,
  modulus: Uint8Array,
  authorizationDigest: Uint8Array,
): GoogleCircuitInputs {
  const signingInput = encoder.encode(`${token.headerB64}.${token.payloadB64}`)
  if (signingInput.length > SIGNING_INPUT_MAX) throw new Error('Google signing input is too long')
  if (token.payload.length > PAYLOAD_JSON_MAX) throw new Error('Google token payload is too long')

  const { aud, sub, email, exp, nonce } = token.claims
  const emailBytes = encoder.encode(email)
  const subBytes = encoder.encode(sub)
  const audienceBytes = encoder.encode(aud)
  const paddedEmail = pad(emailBytes, MAX_EMAIL_BYTES)
  const paddedSub = pad(subBytes, MAX_SUB_BYTES)
  const expString = String(exp)

  const emailOffset = findOffset(token.payload, `"email":"${email}"`)
  const nonceOffset = findOffset(token.payload, `"nonce":"${nonce}"`)
  const subOffset = findOffset(token.payload, `"sub":"${sub}"`)
  const emailVerifiedOffset = findOffset(token.payload, '"email_verified":true')
  const expOffset = findOffset(token.payload, `"exp":${expString}`)
  const issOffset = findOffset(token.payload, '"iss":"https://accounts.google.com"')
  const audOffset = findOffset(token.payload, `"aud":"${aud}"`)

  const modulusInteger = bytesToBigInt(modulus)
  const redc = (1n << (2n * 2048n + BARRETT_OVERFLOW_BITS)) / modulusInteger

  return {
    signing_input: Array.from(pad(signingInput, SIGNING_INPUT_MAX)),
    signing_input_len: String(signingInput.length),
    header_b64_len: String(token.headerB64.length),
    payload_json: Array.from(pad(token.payload, PAYLOAD_JSON_MAX)),
    payload_json_len: String(token.payload.length),
    email_offset: String(emailOffset),
    nonce_offset: String(nonceOffset),
    sub_offset: String(subOffset),
    email_verified_offset: String(emailVerifiedOffset),
    exp_offset: String(expOffset),
    exp_len: String(expString.length),
    iss_offset: String(issOffset),
    aud_offset: String(audOffset),
    email_bytes: Array.from(paddedEmail),
    email_len: String(emailBytes.length),
    sub_bytes: Array.from(paddedSub),
    sub_len: String(subBytes.length),
    audience_bytes: Array.from(pad(audienceBytes, MAX_AUD_BYTES)),
    audience_len: String(audienceBytes.length),
    signature: limbs(bytesToBigInt(token.signature)).map(hex),
    redc: limbs(redc).map(hex),
    authorization_digest: Array.from(authorizationDigest),
    audience_hash: audienceHash(audienceBytes).map(hex),
    sub_packed: pack31(paddedSub).map(hex),
    email_packed: pack31(paddedEmail).map(hex),
    exp: expString,
    modulus: limbs(modulusInteger).map(hex),
  }
}
