import { sha256 } from '@noble/hashes/sha2.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import type { IdentityNodes } from '../../../identity.js'
import { bytesToBigInt, fieldHex, halves } from '../../parameters.js'
import {
  BARRETT_OVERFLOW_BITS,
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
export interface OidcGoogleToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; sub: string; email: string; exp: number; nonce: string }
}

const encoder = new TextEncoder()

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
  if (bytes.length > length) throw new Error(`Value exceeds circuit limit ${length}`)
  const result = new Uint8Array(length)
  result.set(bytes)
  return result
}

/** The audience's SHA-256 as two big-endian 128-bit halves. */
const audienceHash = (audience: Uint8Array): bigint[] => halves(sha256(audience))

const hex = (value: bigint) => `0x${value.toString(16)}`

/** The first occurrence of a signed claim, which must follow the opening brace and end a member. */
function findOffset(payload: Uint8Array, pattern: string): number {
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

/**
 * Build the exact libid-circuits v0.7.1 `oidc_google` circuit inputs. `nodes` are the token's
 * id node and handle node, which the circuit recomputes from the signed `sub` and `email`.
 */
export function buildOidcGoogleInputs(
  token: OidcGoogleToken,
  modulus: Uint8Array,
  authorizationDigest: Uint8Array,
  nodes: IdentityNodes,
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
    email_bytes: Array.from(pad(emailBytes, MAX_EMAIL_BYTES)),
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
    id_node: halves(nodes.idNode).map(hex),
    handle_node: halves(nodes.handleNode).map(hex),
    exp: expString,
    modulus: limbs(modulusInteger).map(hex),
  }
}

/** The exact 57 public fields, in circuit order, for the values a proof binds (REQ-PLAT-16B). */
export function buildOidcGooglePublicInputs(
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
