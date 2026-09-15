// Google id_token → `jwt_email` Noir circuit inputs, in pure TypeScript.
//
// Everything here is deterministic and byte-exact against the circuit's
// expectations: the proof only verifies on-chain if every offset, limb,
// and padded byte matches what `jwt_email` (libid-org/libID-circuits) and
// the Solidity verifier expect. `circuitInputs.test.ts` checks each
// transform from first principles; the harness's Google claim run is the
// end-to-end judge.
//
// The transforms, in order:
//   1. base64url-decode (strict, no padding) the JWT header/payload/signature.
//   2. Validate the claims the circuit constrains: RS256, `email_verified`,
//      `nonce` == the holder address, `aud` == the OAuth client id.
//   3. Find each claim's byte offset in the raw payload JSON (the circuit
//      re-reads them at those offsets under the SHA-256 preimage).
//   4. Zero-pad signing input / payload / claim buffers to the circuit's
//      fixed sizes (1280 / 768 / 62 / 62 / 31 / 128).
//   5. Decompose signature + JWKS modulus into 18 little-endian 120-bit
//      limbs, and derive the noir-bignum v0.10 Barrett parameter
//      `redc = floor(2^(2*2048+6) / n)`.
//   6. Pack email/nonce (62 bytes → 2 Fields) and sub (31 bytes → 1 Field)
//      big-endian, and split SHA-256(client_id) into two 128-bit halves.

// ---- circuit-bound constants ----------------------------------------------
const SIGNING_INPUT_MAX = 1280
const PAYLOAD_JSON_MAX = 768
const EMAIL_MAX = 62
const NONCE_MAX = 62
const SUB_MAX = 31
const AUDIENCE_MAX = 128
const NUM_LIMBS = 18
const RSA_BITS = 2048
// noir-bignum v0.10 Barrett overflow bits (was 4 in v0.6).
const BARRETT_OVERFLOW_BITS = 6

// ---- base64url (strict: no padding, canonical trailing bits) --------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64URL_REV = new Int8Array(128).fill(-1)
for (let i = 0; i < B64URL.length; i++) B64URL_REV[B64URL.charCodeAt(i)] = i

/** Decode unpadded base64url, strictly: invalid characters, padding, a
 *  lone trailing character, and non-canonical (non-zero) trailing bits
 *  are all errors. */
export function b64urlDecode(s: string): Uint8Array {
  const rem = s.length % 4
  if (rem === 1) throw new Error('invalid base64url length')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64URL_REV[c] : -1
    if (v < 0) throw new Error(`invalid base64url character at ${i}`)
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  // Canonical encodings leave only zero bits behind.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new Error('invalid base64url trailing bits')
  }
  return out
}

// ---- small helpers --------------------------------------------------------

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let acc = 0n
  for (const b of bytes) acc = (acc << 8n) | BigInt(b)
  return acc
}

function bigIntBits(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length
}

/** Byte-wise substring search in the raw payload JSON. */
function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

function findOffset(payload: Uint8Array, pattern: string): number {
  const idx = findBytes(payload, textEncoder.encode(pattern))
  if (idx < 0) throw new Error(`pattern not found: ${JSON.stringify(pattern)}`)
  return idx
}

/** Split an N-bit big number into 120-bit limbs, little-endian. */
export function splitIntoLimbs(n: bigint, numLimbs: number): bigint[] {
  const mask = (1n << 120n) - 1n
  const limbs: bigint[] = []
  for (let i = 0; i < numLimbs; i++) limbs.push((n >> BigInt(120 * i)) & mask)
  return limbs
}

/** Pack 31 bytes big-endian into a single Field-fitting bigint. */
function pack31Bytes(bytes: Uint8Array): bigint {
  let acc = 0n
  for (let i = 0; i < 31 && i < bytes.length; i++) acc = acc * 256n + BigInt(bytes[i])
  return acc
}

/** Pack a 62-byte zero-padded buffer into [Field; 2]. */
function pack62Bytes(buf: Uint8Array): [bigint, bigint] {
  return [pack31Bytes(buf.subarray(0, 31)), pack31Bytes(buf.subarray(31, 62))]
}

function zeroPadded(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  out.set(bytes)
  return out
}

const hex = (n: bigint) => `0x${n.toString(16)}`

/** Parse a `0x`-prefixed (or bare) 40-hex-char address into 20 bytes. */
function parseAddr20(s: string): Uint8Array {
  const h = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s
  if (h.length !== 40 || !/^[0-9a-fA-F]{40}$/.test(h)) {
    throw new Error('registry_addr must be 20 bytes of hex')
  }
  const out = new Uint8Array(20)
  for (let i = 0; i < 20; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ---- JWT parsing ----------------------------------------------------------

export interface ParsedJwt {
  headerB64: string
  signingInput: string
  payloadJsonBytes: Uint8Array
  kid: string
  email: string
  nonce: string
  sub: string
  audience: string
  exp: bigint
  /** Raw 256-byte RSA signature as a bigint. */
  signature: bigint
  emailOffset: number
  nonceOffset: number
  subOffset: number
  emailVerifiedOffset: number
  issOffset: number
  audOffset: number
  expOffset: number
  expLen: number
}

/** Decode a JWT and pre-compute every offset, claim, and packed value the
 *  circuit needs. Doesn't do any RSA work. */
export function parseJwt(
  idToken: string,
  expectedNonce: string,
  expectedAudience: string,
): ParsedJwt {
  if (!expectedAudience) throw new Error('expected audience is empty')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII means 0x00-0x7f
  if (!/^[\x00-\x7f]*$/.test(expectedAudience)) {
    throw new Error('expected audience must be ASCII')
  }
  if (expectedAudience.length > AUDIENCE_MAX) {
    throw new Error(`audience exceeds AUDIENCE_MAX=${AUDIENCE_MAX}`)
  }
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('JWT must have 3 parts')
  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = `${headerB64}.${payloadB64}`

  const header = JSON.parse(textDecoder.decode(b64urlDecode(headerB64))) as Record<string, unknown>
  if (header.alg !== 'RS256') throw new Error('alg must be RS256')
  const kid = header.kid
  if (typeof kid !== 'string') throw new Error('no `kid` in header')

  const payloadJsonBytes = b64urlDecode(payloadB64)
  const payload = JSON.parse(textDecoder.decode(payloadJsonBytes)) as Record<string, unknown>
  const email = payload.email
  if (typeof email !== 'string') {
    throw new Error('no `email` claim — was the email scope granted?')
  }
  if (payload.email_verified !== true) throw new Error('email_verified is false')

  const nonce = payload.nonce
  if (typeof nonce !== 'string') throw new Error('no `nonce` claim in JWT')
  if (nonce !== expectedNonce) {
    throw new Error(`nonce mismatch: expected ${expectedNonce}, got ${nonce}`)
  }

  const sub = payload.sub
  if (typeof sub !== 'string') throw new Error('no `sub` claim in JWT')
  if (sub.length > SUB_MAX) throw new Error(`sub exceeds SUB_MAX=${SUB_MAX}`)

  const audience = payload.aud
  if (typeof audience !== 'string') throw new Error('no string `aud` claim in JWT')
  if (audience !== expectedAudience) {
    throw new Error(`audience mismatch: expected ${expectedAudience}, got ${audience}`)
  }

  // ---- offsets in the raw payload JSON ----
  const emailOffset = findOffset(payloadJsonBytes, `"email":"${email}"`)
  const nonceOffset = findOffset(payloadJsonBytes, `"nonce":"${nonce}"`)
  const subOffset = findOffset(payloadJsonBytes, `"sub":"${sub}"`)
  const emailVerifiedOffset = findOffset(payloadJsonBytes, '"email_verified":true')
  const issOffset = findOffset(payloadJsonBytes, '"iss":"https://accounts.google.com"')
  const audOffset = findOffset(payloadJsonBytes, `"aud":"${audience}"`)

  // ---- exp claim: offset of `"exp":` plus the run of digits after it ----
  const expOffset = findOffset(payloadJsonBytes, '"exp":')
  const expDigitsStart = expOffset + 6
  let expLen = 0
  while (
    expDigitsStart + expLen < payloadJsonBytes.length &&
    payloadJsonBytes[expDigitsStart + expLen] >= 0x30 &&
    payloadJsonBytes[expDigitsStart + expLen] <= 0x39
  ) {
    expLen += 1
  }
  if (expLen === 0) throw new Error('`exp` value has no digits')
  const exp = BigInt(
    textDecoder.decode(payloadJsonBytes.subarray(expDigitsStart, expDigitsStart + expLen)),
  )

  // ---- signature ----
  const sigBytes = b64urlDecode(sigB64)
  if (sigBytes.length !== 256) throw new Error('signature must be 256 bytes')
  const signature = bytesToBigIntBE(sigBytes)

  return {
    headerB64,
    signingInput,
    payloadJsonBytes,
    kid,
    email,
    nonce,
    sub,
    audience,
    exp,
    signature,
    emailOffset,
    nonceOffset,
    subOffset,
    emailVerifiedOffset,
    issOffset,
    audOffset,
    expOffset,
    expLen,
  }
}

// ---- prover-input building ------------------------------------------------

/** noir_js-ready inputs for `jwt_email`: hex strings for numerics, plain
 *  number arrays for byte buffers. */
export interface OidcProverInputs {
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
  chain_id: string
  registry_addr: string
  email_bytes: number[]
  email_len: string
  nonce_bytes: number[]
  nonce_len: string
  sub_bytes: number[]
  sub_len: string
  audience_bytes: number[]
  audience_len: string
  signature: string[]
  redc: string[]
  modulus: string[]
  email_packed: string[]
  nonce_packed: string[]
  sub_packed: string[]
  audience_hash: string[]
  exp: string
}

/** Combine a parsed JWT with its matching JWK modulus (the base64url `n`)
 *  to build everything the Noir circuit needs. Async only for WebCrypto's
 *  SHA-256 of the client id. */
export async function buildProverInputsFromJwt(
  jwt: ParsedJwt,
  jwkNB64url: string,
  chainId: bigint,
  registryAddr: string,
): Promise<OidcProverInputs> {
  if (chainId < 0n || chainId >= 1n << 64n) throw new Error('chain_id must fit in u64')
  const addr = parseAddr20(registryAddr)
  const n = bytesToBigIntBE(b64urlDecode(jwkNB64url))
  const nBits = bigIntBits(n)
  if (nBits > RSA_BITS || nBits <= RSA_BITS - 8) throw new Error('modulus is not ~2048 bits')

  // Barrett redc parameter, formula per noir-bignum v0.10:
  //   redc = floor(2^(2*MOD_BITS + BARRETT_OVERFLOW_BITS) / n)
  const redc = (1n << BigInt(2 * RSA_BITS + BARRETT_OVERFLOW_BITS)) / n

  const signingInputBytes = textEncoder.encode(jwt.signingInput)
  if (signingInputBytes.length > SIGNING_INPUT_MAX) {
    throw new Error(
      `signing input is ${signingInputBytes.length} bytes, exceeds SIGNING_INPUT_MAX=${SIGNING_INPUT_MAX}`,
    )
  }
  if (jwt.payloadJsonBytes.length > PAYLOAD_JSON_MAX) {
    throw new Error(
      `payload JSON is ${jwt.payloadJsonBytes.length} bytes, exceeds PAYLOAD_JSON_MAX=${PAYLOAD_JSON_MAX}`,
    )
  }

  // The circuit sees BYTE lengths — encode first; UTF-16 .length lies.
  const emailRaw = textEncoder.encode(jwt.email)
  const nonceRaw = textEncoder.encode(jwt.nonce)
  const subRaw = textEncoder.encode(jwt.sub)
  const audienceRaw = textEncoder.encode(jwt.audience)
  if (emailRaw.length > EMAIL_MAX) throw new Error(`email exceeds EMAIL_MAX=${EMAIL_MAX}`)
  if (nonceRaw.length > NONCE_MAX) throw new Error(`nonce exceeds NONCE_MAX=${NONCE_MAX}`)
  if (subRaw.length > SUB_MAX) throw new Error(`sub exceeds SUB_MAX=${SUB_MAX}`)
  if (audienceRaw.length > AUDIENCE_MAX) {
    throw new Error(`audience exceeds AUDIENCE_MAX=${AUDIENCE_MAX}`)
  }
  const emailBytes = zeroPadded(emailRaw, EMAIL_MAX)
  const nonceBytes = zeroPadded(nonceRaw, NONCE_MAX)
  const subBytes = zeroPadded(subRaw, SUB_MAX)
  const audienceBytes = zeroPadded(audienceRaw, AUDIENCE_MAX)

  // Full SHA-256(client_id), split into two big-endian 128-bit values.
  const audienceDigest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', textEncoder.encode(jwt.audience)),
  )
  const audienceHash = [
    bytesToBigIntBE(audienceDigest.subarray(0, 16)),
    bytesToBigIntBE(audienceDigest.subarray(16)),
  ]

  const toBytes = (b: Uint8Array) => Array.from(b)
  const toHex = (ls: bigint[]) => ls.map(hex)

  return {
    signing_input: toBytes(zeroPadded(signingInputBytes, SIGNING_INPUT_MAX)),
    signing_input_len: String(signingInputBytes.length),
    header_b64_len: String(jwt.headerB64.length),
    payload_json: toBytes(zeroPadded(jwt.payloadJsonBytes, PAYLOAD_JSON_MAX)),
    payload_json_len: String(jwt.payloadJsonBytes.length),
    email_offset: String(jwt.emailOffset),
    nonce_offset: String(jwt.nonceOffset),
    sub_offset: String(jwt.subOffset),
    email_verified_offset: String(jwt.emailVerifiedOffset),
    exp_offset: String(jwt.expOffset),
    exp_len: String(jwt.expLen),
    iss_offset: String(jwt.issOffset),
    aud_offset: String(jwt.audOffset),
    chain_id: chainId.toString(),
    registry_addr: `0x${Array.from(addr, (b) => b.toString(16).padStart(2, '0')).join('')}`,
    email_bytes: toBytes(emailBytes),
    email_len: String(emailRaw.length),
    nonce_bytes: toBytes(nonceBytes),
    nonce_len: String(nonceRaw.length),
    sub_bytes: toBytes(subBytes),
    sub_len: String(subRaw.length),
    audience_bytes: toBytes(audienceBytes),
    audience_len: String(audienceRaw.length),
    signature: toHex(splitIntoLimbs(jwt.signature, NUM_LIMBS)),
    redc: toHex(splitIntoLimbs(redc, NUM_LIMBS)),
    modulus: toHex(splitIntoLimbs(n, NUM_LIMBS)),
    email_packed: toHex(pack62Bytes(emailBytes)),
    nonce_packed: toHex(pack62Bytes(nonceBytes)),
    sub_packed: [hex(pack31Bytes(subBytes))],
    audience_hash: toHex(audienceHash),
    exp: jwt.exp.toString(),
  }
}

/** One-shot: id_token + JWK modulus → noir_js inputs. */
export async function buildOidcProverInputs(
  idToken: string,
  jwkNB64url: string,
  expectedNonce: string,
  expectedClientId: string,
  chainId: bigint,
  registryAddr: string,
): Promise<OidcProverInputs> {
  const jwt = parseJwt(idToken, expectedNonce, expectedClientId)
  return buildProverInputsFromJwt(jwt, jwkNB64url, chainId, registryAddr)
}
