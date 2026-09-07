// The normative authorization constructions shared by the platform slices:
// the Authorization Digest (ceremony-common §5, REQ-COMMON-01) and the S256
// PKCE derivation X and GitHub bind it with (§7, REQ-COMMON-12). Only the
// Ceremony Client derives these; the prover receives the already-derived
// code verifier and does not receive the authorization nonce.
//
// Hashes come from @noble/hashes: keccak256 has no native browser
// implementation, and taking sha256 from the same audited pin keeps these
// functions synchronous and dependency-minimal.

import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { b64urlEncode } from '../primitives.js'

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
  if (!Number.isInteger(version) || version < 0 || version > 0xffff) {
    throw new Error('platformCeremonyVersion must fit an unsigned 16-bit integer')
  }
  if (transactionData.length > 0xffffffff) {
    throw new Error('transactionData length must fit an unsigned 32-bit integer')
  }
  const preimage = new Uint8Array(102 + transactionData.length)
  const view = new DataView(preimage.buffer)
  preimage.set(exact(input.operationDomain, 32, 'operationDomain'), 0)
  view.setUint16(32, version)
  preimage.set(exact(input.chainId, 32, 'chainId'), 34)
  preimage.set(exact(input.authorizationNonce, 32, 'authorizationNonce'), 66)
  view.setUint32(98, transactionData.length)
  preimage.set(transactionData, 102)
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
  const binding = new Uint8Array(64)
  binding.set(exact(authorizationDigest, 32, 'authorizationDigest'), 0)
  binding.set(exact(authorizationNonce, 32, 'authorizationNonce'), 32)
  return b64urlEncode(sha256(binding))
}

/** `BASE64URL_NOPAD(SHA256(ASCII(code_verifier)))` — the S256 challenge. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return b64urlEncode(sha256(new TextEncoder().encode(codeVerifier)))
}

/** `keccak256(UTF8(domainString))` — how a Consumer fixes an operation domain
 *  (REQ-COMMON-01A); exposed for compositions and tests. */
export function operationDomainFromString(domainString: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(domainString))
}

/** Form-authenticated client IDs must be byte-identical under form serialization. */
export const isFormClientId = (value: string): boolean => /^[A-Za-z0-9*._-]+$/.test(value)
