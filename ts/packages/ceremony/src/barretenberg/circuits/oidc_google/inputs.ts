import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes } from '@noble/hashes/utils.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../platforms/authorization.js'
import { fieldHex } from '../../parameters.js'
import {
  BARRETT_OVERFLOW_BITS,
  FIELD_PACK_BYTES,
  HASH_FIELD_BYTES,
  ISSUER,
  LIMB_BITS,
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_PAYLOAD_JSON_BYTES,
  MAX_SIGNING_INPUT_BYTES,
  MAX_SUB_BYTES,
  NUM_LIMBS,
  RSA_MODULUS_BITS,
  USER_ID_TAG,
} from './parameters.js'

/** Token bytes and claim values consumed by the fixed oidc_google circuit. */
export interface OidcGoogleToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; sub: string; email: string; exp: number; nonce: string }
}

const encoder = new TextEncoder()

/** Interpret the circuit's byte arrays as unsigned big-endian integers. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

/** Split an RSA integer into the ABI's least-significant-first limbs. */
function limbs(value: bigint): bigint[] {
  const mask = (1n << LIMB_BITS) - 1n
  return Array.from(
    { length: NUM_LIMBS },
    (_, index) => (value >> (LIMB_BITS * BigInt(index))) & mask,
  )
}

/** Zero-pad a value to its fixed circuit width. */
function pad(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length > length) throw new Error(`value exceeds circuit limit ${length}`)
  const result = new Uint8Array(length)
  result.set(bytes)
  return result
}

/** Pack padded bytes into big-endian FIELD_PACK_BYTES-byte field elements. */
function pack31(bytes: Uint8Array): bigint[] {
  return Array.from({ length: Math.ceil(bytes.length / FIELD_PACK_BYTES) }, (_, index) =>
    bytesToBigInt(bytes.subarray(index * FIELD_PACK_BYTES, (index + 1) * FIELD_PACK_BYTES)),
  )
}

/** A SHA-256 hash as two big-endian 128-bit halves. */
function hashFields(hash: Uint8Array): bigint[] {
  return [
    bytesToBigInt(hash.subarray(0, HASH_FIELD_BYTES)),
    bytesToBigInt(hash.subarray(HASH_FIELD_BYTES)),
  ]
}

/** The audience's SHA-256 as two big-endian 128-bit halves. */
const audienceHash = (audience: Uint8Array): bigint[] => hashFields(sha256(audience))

/** The Google userId's hash (REQ-PLAT-05A): SHA-256 of the tag and the exact signed `sub` bytes. */
export const userIdHash = (sub: Uint8Array): Uint8Array =>
  sha256(concatBytes(encoder.encode(USER_ID_TAG), sub))

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

/** Build the exact libid-circuits v0.5.0 `oidc_google` circuit inputs. */
export function buildOidcGoogleInputs(
  token: OidcGoogleToken,
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
    sub_bytes: Array.from(pad(subBytes, MAX_SUB_BYTES)),
    sub_len: String(subBytes.length),
    audience_bytes: Array.from(pad(audienceBytes, MAX_AUD_BYTES)),
    audience_len: String(audienceBytes.length),
    signature: limbs(bytesToBigInt(token.signature)).map(hex),
    redc: limbs(
      (1n << (2n * BigInt(RSA_MODULUS_BITS) + BARRETT_OVERFLOW_BITS)) / modulusInteger,
    ).map(hex),
    authorization_digest: Array.from(authorizationDigest),
    audience_hash: audienceHash(audienceBytes).map(hex),
    user_id_hash: hashFields(userIdHash(subBytes)).map(hex),
    email_packed: pack31(paddedEmail).map(hex),
    exp: expString,
    modulus: limbs(modulusInteger).map(hex),
  }
}

/** The oidc_google circuit inputs, keyed in the circuit's ABI order. */

const packed = (value: string, width: number) =>
  pack31(pad(encoder.encode(value), width)).map(fieldHex)

/** The exact 57 public fields, in circuit order, for the values a proof binds. */
export function buildOidcGooglePublicInputs(values: {
  authorizationDigest: Uint8Array
  audience: string
  userIdHash: Uint8Array
  email: string
  expiresAt: number
  modulus: Uint8Array
}): string[] {
  if (values.authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES)
    throw new Error('authorizationDigest must be exactly 32 bytes')
  return [
    ...Array.from(values.authorizationDigest, fieldHex),
    ...audienceHash(encoder.encode(values.audience)).map(fieldHex),
    ...hashFields(values.userIdHash).map(fieldHex),
    ...packed(values.email, MAX_EMAIL_BYTES),
    fieldHex(values.expiresAt),
    ...limbs(bytesToBigInt(values.modulus)).map(fieldHex),
  ]
}
