// The normative authorization constructions shared by the platform slices:
// the Authorization Digest (ceremony-common §5, REQ-COMMON-01), the S256
// PKCE derivation X and GitHub bind it with (§7, REQ-COMMON-12) and their
// common code-request layout. Only the Ceremony Client derives these; the
// prover receives the already-derived code verifier and does not receive the
// authorization nonce.
//
// Hashes come from @noble/hashes: keccak256 has no native browser
// implementation, and taking sha256 from the same audited pin keeps these
// functions synchronous and dependency-minimal.

import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { concatBytes } from '@noble/hashes/utils.js'
import { b64urlDecode, b64urlEncode } from '../primitives.js'

/** ceremony-common §5: digest/hash widths, fresh nonce and unsigned wire fields. */
export const AUTHORIZATION_DIGEST_BYTES = keccak_256.outputLen
export const OPERATION_DOMAIN_BYTES = keccak_256.outputLen
export const CHAIN_ID_BYTES = keccak_256.outputLen
export const AUTHORIZATION_NONCE_BYTES = 32
export const MAX_CEREMONY_VERSION = 0xffff
export const MAX_TRANSACTION_DATA_BYTES = 0xffffffff

const VERSION_OFFSET = OPERATION_DOMAIN_BYTES
const CHAIN_ID_OFFSET = VERSION_OFFSET + Uint16Array.BYTES_PER_ELEMENT
const NONCE_OFFSET = CHAIN_ID_OFFSET + CHAIN_ID_BYTES
const TRANSACTION_LENGTH_OFFSET = NONCE_OFFSET + AUTHORIZATION_NONCE_BYTES
const TRANSACTION_OFFSET = TRANSACTION_LENGTH_OFFSET + Uint32Array.BYTES_PER_ELEMENT

/** Unpadded base64url spelling of one S256 output. */
const PKCE_CHARS = Math.ceil((sha256.outputLen * 8) / 6)
export const isPkceValue = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === PKCE_CHARS &&
  b64urlDecode(value)?.length === sha256.outputLen

export interface AuthorizationInput {
  /** `keccak256(UTF8(domainString))` — exactly 32 bytes, supplied by the composition. */
  operationDomain: Uint8Array
  platformCeremonyVersion: number
  /** `keccak256` of the Chain Profile's canonical identifier bytes — exactly 32 bytes. */
  chainId: Uint8Array
  /** Fresh 32 cryptographically secure random bytes per ceremony. */
  authorizationNonce: Uint8Array
  /** Opaque canonical bytes; the U32BE length field bounds it. */
  transactionData: Uint8Array
}

function exact(bytes: Uint8Array, width: number, name: string): Uint8Array {
  if (bytes.length !== width) throw new Error(`${name} must be exactly ${width} bytes`)
  return bytes
}

/**
 * `keccak256(operationDomain || U16BE(version) || chainId || nonce ||
 * U32BE(len(transactionData)) || transactionData)` — every field width
 * checked, values that do not fit their field rejected (REQ-COMMON-01).
 */
export function deriveAuthorizationDigest(input: AuthorizationInput): Uint8Array {
  const { platformCeremonyVersion: version, transactionData } = input
  if (!Number.isInteger(version) || version < 0 || version > MAX_CEREMONY_VERSION) {
    throw new Error('platformCeremonyVersion must fit an unsigned 16-bit integer')
  }
  if (transactionData.length > MAX_TRANSACTION_DATA_BYTES) {
    throw new Error('transactionData length must fit an unsigned 32-bit integer')
  }
  const preimage = new Uint8Array(TRANSACTION_OFFSET + transactionData.length)
  const view = new DataView(preimage.buffer)
  preimage.set(exact(input.operationDomain, OPERATION_DOMAIN_BYTES, 'operationDomain'), 0)
  view.setUint16(VERSION_OFFSET, version)
  preimage.set(exact(input.chainId, CHAIN_ID_BYTES, 'chainId'), CHAIN_ID_OFFSET)
  preimage.set(
    exact(input.authorizationNonce, AUTHORIZATION_NONCE_BYTES, 'authorizationNonce'),
    NONCE_OFFSET,
  )
  view.setUint32(TRANSACTION_LENGTH_OFFSET, transactionData.length)
  preimage.set(transactionData, TRANSACTION_OFFSET)
  return keccak_256(preimage)
}

/**
 * `BASE64URL_NOPAD(SHA256(authorizationDigest || authorizationNonce))` —
 * exactly 43 base64url characters (REQ-COMMON-12). The nonce is the same
 * one committed by the digest; it must not be emitted anywhere before the
 * token exchange completes (REQ-COMMON-14).
 */
export function deriveCodeVerifier(
  authorizationDigest: Uint8Array,
  authorizationNonce: Uint8Array,
): string {
  const binding = concatBytes(
    exact(authorizationDigest, AUTHORIZATION_DIGEST_BYTES, 'authorizationDigest'),
    exact(authorizationNonce, AUTHORIZATION_NONCE_BYTES, 'authorizationNonce'),
  )
  return b64urlEncode(sha256(binding))
}

/** `BASE64URL_NOPAD(SHA256(ASCII(code_verifier)))` — the S256 challenge. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return b64urlEncode(sha256(new TextEncoder().encode(codeVerifier)))
}

/**
 * An S256 authorization-code request: the platform's leading fields, then `client_id`,
 * `redirect_uri`, `scope`, `state`, `code_challenge` and `code_challenge_method` in
 * exactly this order, serialized by the WHATWG form-urlencoded serializer.
 */
export function pkceAuthorizationUrl(
  endpoint: string,
  scope: string,
  leading: [string, string][] = [],
) {
  return (input: {
    clientId: string
    redirectUri: string
    state: string
    codeChallenge: string | null
  }): string => {
    if (input.codeChallenge === null || !isPkceValue(input.codeChallenge)) {
      throw new Error('codeChallenge must be exactly 43 base64url characters')
    }
    const query = new URLSearchParams([
      ...leading,
      ['client_id', input.clientId],
      ['redirect_uri', input.redirectUri],
      ['scope', scope],
      ['state', input.state],
      ['code_challenge', input.codeChallenge],
      ['code_challenge_method', 'S256'],
    ])
    return `${endpoint}?${query}`
  }
}

/** Form-authenticated client IDs must be byte-identical under form serialization. */
export const isFormClientId = (value: string): boolean => /^[A-Za-z0-9*._-]+$/.test(value)
