/**
 * Noir witness builder for the new X token-only ZK circuit.
 *
 * Sizing constants MUST match the Noir globals in
 * `circuits/x-token/src/main.nr` (libid-org/libID-circuits).
 */

import { keccak256, sha256, toBytes } from 'viem'

function sha256Bytes(input: Uint8Array): Uint8Array {
  return toBytes(sha256(input))
}

function keccak256Bytes(input: Uint8Array): Uint8Array {
  return toBytes(keccak256(input))
}

// ── Sizing constants (mirror Noir globals) ─────────────────────────────────

export const MAX_BEARER_LEN = 128
export const BLINDER_LEN = 16
const NULLIFIER_INPUT_LEN = 132 // MAX_BEARER_LEN + 4 (BE u32 len)

// ── Public types ────────────────────────────────────────────────────────────

export interface XTokenWitness {
  /** Padded bearer bytes (MAX_BEARER_LEN). */
  bearer: Uint8Array
  /** Actual bearer length (≤ MAX_BEARER_LEN). */
  bearerLen: number
  /** TLSN blinder from the /token session (BLINDER_LEN). */
  blinderToken: Uint8Array
  /** TLSN blinder from the /me session (BLINDER_LEN). */
  blinderMe: Uint8Array
  /** Public: SHA256(bearer || blinder_token). Matches /token attestation. */
  bearerHashToken: Uint8Array
  /** Public: SHA256(bearer || blinder_me). Matches /me attestation. */
  bearerHashMe: Uint8Array
  /** Public: keccak256(bearer_padded || len_be32). */
  nullifier: Uint8Array
  /** Public: 20-byte EVM wallet (msg.sender bound on chain). */
  walletAddress: Uint8Array
  /** Public: 20-byte session key the wallet will register. */
  sessionAddr: Uint8Array
}

// ── Builders ────────────────────────────────────────────────────────────────

function padTo(src: Uint8Array, n: number, label: string): Uint8Array {
  if (src.length > n) {
    throw new Error(`[witness-token] ${label} length ${src.length} > cap ${n}`)
  }
  const out = new Uint8Array(n)
  out.set(src, 0)
  return out
}

/**
 * Mirror of `compute_bearer_nullifier` in the x-token circuit:
 *   keccak256(bearer_padded || bearer_len.be32)
 */
function computeBearerNullifier(bearerPadded: Uint8Array, bearerLen: number): Uint8Array {
  if (bearerPadded.length !== MAX_BEARER_LEN) {
    throw new Error(`[witness-token] bearerPadded must be ${MAX_BEARER_LEN} bytes`)
  }
  const buf = new Uint8Array(NULLIFIER_INPUT_LEN)
  buf.set(bearerPadded, 0)
  const lenView = new DataView(buf.buffer, buf.byteOffset + MAX_BEARER_LEN, 4)
  lenView.setUint32(0, bearerLen >>> 0, false) // big-endian
  return keccak256Bytes(buf)
}

/**
 * Mirror of `verify_hash_commit` in the x-token circuit (without enforcement):
 *   SHA256(plaintext_padded[0..plaintext_len] || blinder)
 */
export function computeBearerHash(
  bearer: Uint8Array,
  bearerLen: number,
  blinder: Uint8Array,
): Uint8Array {
  if (blinder.length !== BLINDER_LEN) {
    throw new Error(`[witness-token] blinder must be ${BLINDER_LEN} bytes`)
  }
  const input = new Uint8Array(bearerLen + BLINDER_LEN)
  input.set(bearer.subarray(0, bearerLen), 0)
  input.set(blinder, bearerLen)
  return sha256Bytes(input)
}

/** Build a complete `XTokenWitness` from the bearer plaintext + identity. */
export function buildXTokenWitness(params: {
  bearer: Uint8Array // unpadded
  blinderToken: Uint8Array // BLINDER_LEN bytes, from /token TLSN session
  blinderMe: Uint8Array // BLINDER_LEN bytes, from /me TLSN session
  walletAddress: Uint8Array // 20 bytes
  sessionAddr: Uint8Array // 20 bytes
}): XTokenWitness {
  if (params.walletAddress.length !== 20) {
    throw new Error('[witness-token] walletAddress must be 20 bytes')
  }
  if (params.sessionAddr.length !== 20) {
    throw new Error('[witness-token] sessionAddr must be 20 bytes')
  }
  const bearerLen = params.bearer.length
  const bearer = padTo(params.bearer, MAX_BEARER_LEN, 'bearer')
  const bearerHashToken = computeBearerHash(bearer, bearerLen, params.blinderToken)
  const bearerHashMe = computeBearerHash(bearer, bearerLen, params.blinderMe)
  const nullifier = computeBearerNullifier(bearer, bearerLen)
  return {
    bearer,
    bearerLen,
    blinderToken: params.blinderToken,
    blinderMe: params.blinderMe,
    bearerHashToken,
    bearerHashMe,
    nullifier,
    walletAddress: params.walletAddress,
    sessionAddr: params.sessionAddr,
  }
}

// ── Noir.js input map ──────────────────────────────────────────────────────

function toNoirByteArr(bytes: Uint8Array): string[] {
  return Array.from(bytes).map((b) => b.toString())
}

/** Format the witness for `Noir.js` `execute`. Keys mirror circuit `main` params. */
export function witnessToNoirInputMap(w: XTokenWitness): Record<string, unknown> {
  return {
    bearer: toNoirByteArr(w.bearer),
    bearer_len: w.bearerLen.toString(),
    blinder_token: toNoirByteArr(w.blinderToken),
    blinder_me: toNoirByteArr(w.blinderMe),
    bearer_hash_token: toNoirByteArr(w.bearerHashToken),
    bearer_hash_me: toNoirByteArr(w.bearerHashMe),
    nullifier: toNoirByteArr(w.nullifier),
    wallet_address: toNoirByteArr(w.walletAddress),
    session_addr: toNoirByteArr(w.sessionAddr),
  }
}
