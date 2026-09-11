// Shared byte and validation primitives. Admission rule: a helper lives here only
// when its consumers span two or more entrypoint bundles (client, popup,
// prover); anything narrower lives beside its one consumer.

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const B64URL_REV = new Int8Array(128).fill(-1)

for (let i = 0; i < B64URL.length; i++) B64URL_REV[B64URL.charCodeAt(i)] = i

/** Encode bytes as canonical unpadded base64url. */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = ''
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out += B64URL[(acc >> bits) & 0x3f]
    }
  }
  if (bits > 0) out += B64URL[(acc << (6 - bits)) & 0x3f]
  return out
}

/**
 * Decode unpadded base64url strictly: padding, invalid characters, an
 * impossible length, and noncanonical (nonzero) trailing bits are all
 * rejected. Returns null instead of throwing — every caller is a validator.
 */
export function b64urlDecode(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64URL_REV[c] : -1
    if (v < 0) return null
    acc = ((acc << 6) | v) & 0x3fff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null
  return out
}

/** Byte equality. Not constant-time; never used to compare secrets. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Exact-shape gate: the record owns exactly the listed keys — unknown
 * fields fail before use. Field types are the caller's next check.
 */
export function hasExactKeys(rec: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(rec).length !== keys.length) return false
  for (const k of keys) if (!Object.hasOwn(rec, k)) return false
  return true
}

export const fixedBytes = (v: unknown, n: number): v is Uint8Array =>
  v instanceof Uint8Array && v.length === n

export function uint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

export function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    new TextEncoder().encode(value).length <= max
  )
}

export function webUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) &&
      !u.username &&
      !u.password &&
      u.href === value
    )
  } catch {
    return false
  }
}

export function origin(value: unknown): value is string {
  return typeof value === 'string' && webUrl(`${value}/`) && new URL(value).origin === value
}
