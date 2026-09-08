import type { Identity } from '../../types.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { b64urlDecode, isRecord } from '../../../primitives.js'
import { decodeGoogleHeader, decodeGoogleIdToken, type DecodedGoogleIdToken } from './token.js'
import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  RSA_MODULUS_BYTES,
  type GoogleProofV1,
} from './types.js'

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

export interface BuiltGoogleWitness {
  inputs: GoogleCircuitInputs
  identity: Identity<'google'>
  proofFields: Omit<GoogleProofV1, 'identityProof'>
}

interface ParsedGoogleIdToken extends DecodedGoogleIdToken {
  kid: string
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function limbs(value: bigint): string[] {
  const mask = (1n << LIMB_BITS) - 1n
  return Array.from(
    { length: NUM_LIMBS },
    (_, index) => `0x${((value >> (LIMB_BITS * BigInt(index))) & mask).toString(16)}`,
  )
}

function pad(bytes: Uint8Array, length: number): number[] {
  if (bytes.length > length) throw new Error(`value exceeds circuit limit ${length}`)
  const result = new Uint8Array(length)
  result.set(bytes)
  return Array.from(result)
}

function pack31(bytes: Uint8Array): string {
  return `0x${bytesToBigInt(bytes).toString(16)}`
}

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

function parseToken(idToken: string): ParsedGoogleIdToken {
  const token = decodeGoogleIdToken(idToken)
  if (token?.claims.iss !== 'https://accounts.google.com') {
    throw new Error('invalid Google ID token')
  }
  const header = decodeGoogleHeader(token.header)
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
    throw new Error('invalid Google ID token header')
  }
  return { ...token, kid: header.kid }
}

function buildWitness(token: ParsedGoogleIdToken, jwk: unknown): BuiltGoogleWitness {
  if (
    !isRecord(jwk) ||
    jwk.kty !== 'RSA' ||
    jwk.e !== 'AQAB' ||
    jwk.kid !== token.kid ||
    typeof jwk.n !== 'string'
  ) {
    throw new Error('JWK does not match the Google ID token')
  }

  const modulus = b64urlDecode(jwk.n)
  if (!modulus || modulus.length !== RSA_MODULUS_BYTES || (modulus[0] & 0x80) === 0) {
    throw new Error('Google signing key must be RSA-2048')
  }
  if (token.signature.length !== RSA_MODULUS_BYTES) {
    throw new Error('Google ID token signature must be 256 bytes')
  }
  const authorizationDigest = b64urlDecode(token.claims.nonce)
  if (authorizationDigest?.length !== 32) {
    throw new Error('Google nonce must encode a 32-byte authorization digest')
  }

  const signingInput = encoder.encode(`${token.headerB64}.${token.payloadB64}`)
  if (signingInput.length > SIGNING_INPUT_MAX) throw new Error('Google signing input is too long')
  if (token.payload.length > PAYLOAD_JSON_MAX) throw new Error('Google token payload is too long')

  const { aud, sub, email, exp, nonce } = token.claims
  const emailBytes = encoder.encode(email)
  const subBytes = encoder.encode(sub)
  const audienceBytes = encoder.encode(aud)
  const paddedEmail = new Uint8Array(pad(emailBytes, MAX_EMAIL_BYTES))
  const paddedSub = new Uint8Array(pad(subBytes, MAX_SUB_BYTES))
  const paddedAudience = new Uint8Array(pad(audienceBytes, MAX_AUD_BYTES))
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
  const audienceDigest = sha256(audienceBytes)

  return {
    inputs: {
      signing_input: pad(signingInput, SIGNING_INPUT_MAX),
      signing_input_len: String(signingInput.length),
      header_b64_len: String(token.headerB64.length),
      payload_json: pad(token.payload, PAYLOAD_JSON_MAX),
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
      audience_bytes: Array.from(paddedAudience),
      audience_len: String(audienceBytes.length),
      signature: limbs(bytesToBigInt(token.signature)),
      redc: limbs(redc),
      authorization_digest: Array.from(authorizationDigest),
      audience_hash: [pack31(audienceDigest.subarray(0, 16)), pack31(audienceDigest.subarray(16))],
      sub_packed: [pack31(paddedSub)],
      email_packed: [pack31(paddedEmail.subarray(0, 31)), pack31(paddedEmail.subarray(31))],
      exp: expString,
      modulus: limbs(modulusInteger),
    },
    identity: { platformId: 'google', oauthClientId: aud, userId: sub, userName: email },
    proofFields: {
      tokenExpiresAt: exp,
      signingKeyModulus: modulus,
    },
  }
}

/** Build the exact libid-circuits v0.3.0 `oidc_google` witness. */
export function buildGoogleWitness(idToken: string, jwk: unknown): BuiltGoogleWitness {
  return buildWitness(parseToken(idToken), jwk)
}
