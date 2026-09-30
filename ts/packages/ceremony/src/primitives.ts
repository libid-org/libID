// Shared byte and validation primitives. Admission rule: a helper lives here only
// when its consumers span two or more entrypoint bundles (client, popup,
// prover); anything narrower lives beside its one consumer.

/** Encode bytes as canonical unpadded base64url. */
export function b64urlEncode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * Decode unpadded base64url strictly: padding, invalid characters, an
 * impossible length, and noncanonical (nonzero) trailing bits are all
 * rejected. Returns null instead of throwing — every caller is a validator.
 */
export function b64urlDecode(s: string): Uint8Array | null {
  if (/[^A-Za-z0-9_-]/.test(s) || s.length % 4 === 1) return null
  const bytes = Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  )
  return b64urlEncode(bytes) === s ? bytes : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Exact-shape gate: a plain record (see `isRecord`) that owns every required key
 * and nothing beyond the optional ones — unknown fields fail before use. Field
 * types are the caller's next check.
 */
export function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    required.every((k) => Object.hasOwn(value, k)) &&
    Object.keys(value).every((k) => required.includes(k) || optional.includes(k))
  )
}

const MAX_SLUG_CHARS = 64
const SLUG = new RegExp(`^[a-z][a-z0-9-]{0,${MAX_SLUG_CHARS - 1}}$`)

/** Lowercase protocol identifiers: platform IDs, event names and attribute keys. */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value)
}

export type Predicates<T> = { [K in keyof T]-?: (value: unknown) => boolean }

/**
 * Validate an exact-shape record: the declared fields (optional ones may be absent) and
 * nothing else, each present value satisfying its predicate; otherwise throw `message`.
 */
export function recordValidator<T>(
  message: string,
  fields: Predicates<T>,
  optional: readonly (keyof T & string)[] = [],
): (value: unknown) => T {
  const keys = Object.keys(fields) as (keyof T & string)[]
  const required = keys.filter((key) => !optional.includes(key))
  return (v) => {
    if (
      !hasExactKeys(v, required, optional) ||
      !keys.every((key) => !Object.hasOwn(v, key) || fields[key](v[key]))
    )
      throw new TypeError(message)
    return v as T
  }
}

export const isFixedBytes = (v: unknown, n: number): v is Uint8Array =>
  v instanceof Uint8Array && v.length === n

export function isUint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

export function isText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    new TextEncoder().encode(value).length <= max
  )
}

export function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) &&
      !u.hostname.includes('*') &&
      !u.username &&
      !u.password &&
      u.href === value
    )
  } catch {
    return false
  }
}

export function isOrigin(value: unknown): value is string {
  return typeof value === 'string' && isWebUrl(`${value}/`) && new URL(value).origin === value
}
