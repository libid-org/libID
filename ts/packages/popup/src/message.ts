// The wire leaf: the transport version, the caller-owned message contract,
// the carrier seam, the two reserved controls, and the validators every
// other module shares. Nothing here touches a browser global.

/** Exact-matched in every private transport record; never negotiated. */
export const CONNECTION_VERSION = 1 as const
export type ConnectionVersion = typeof CONNECTION_VERSION

export interface Message {
  readonly type: string
}

export interface MessageType<M extends Message> {
  readonly type: M['type']
  decode(value: unknown): M
}

/** A connection-internal adapter from a native resource to delivery. */
export interface Carrier {
  send(value: Message): void
  on(handler: (value: unknown) => void): () => void
  close(): void
}

export type CarrierConstructor = (signal: AbortSignal) => Promise<Carrier>

/**
 * Package-private lifecycle hooks of a carrier that cannot be transferred
 * across a document replacement (docs/connection.md, Carrier API). The popup
 * side prepares the next round before navigating; the application side
 * reports the resulting replacement carrier. The connection drives both and
 * never exposes them to callers.
 */
export const prepareNavigation: unique symbol = Symbol('prepareNavigation')
export const onReplacement: unique symbol = Symbol('onReplacement')

export interface NavigationCarrier extends Carrier {
  /** Arms the replacement for `target` and resolves the exact URL to navigate to. */
  [prepareNavigation](target: string): Promise<string>
  /** Reports each pending authenticated replacement carrier; returns an unsubscribe. */
  [onReplacement](handler: (carrier: Promise<Carrier>) => void): () => void
}

export function isNavigationCarrier(carrier: Carrier): carrier is NavigationCarrier {
  return prepareNavigation in carrier && onReplacement in carrier
}

export interface Navigate {
  readonly type: 'navigate'
  readonly url: string
}

export interface ClosePopup {
  readonly type: 'close-popup'
}

export type PopupControl = Navigate | ClosePopup

export const MAX_TYPE_LENGTH = 64

const RESERVED_TYPES: ReadonlySet<string> = new Set(['navigate', 'close-popup'])

export function isReservedType(type: string): boolean {
  return RESERVED_TYPES.has(type)
}

/** A plain record: what structured clone produces for any object value. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Exact-shape gate: the record owns exactly the listed keys. */
export function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(record).length !== keys.length) return false
  for (const key of keys) if (!Object.hasOwn(record, key)) return false
  return true
}

/** The bounded routing discriminator of an inbound value, or null. */
export function routingType(value: unknown): string | null {
  if (!isRecord(value)) return null
  const { type } = value
  return typeof type === 'string' && type.length > 0 && type.length <= MAX_TYPE_LENGTH ? type : null
}

/** An absolute HTTPS URL in its own serialization, without credentials. */
export function isCanonicalHttpsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.href === url &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

export function decodeControl(value: Record<string, unknown>): PopupControl | null {
  if (value.type === 'close-popup') {
    return hasExactKeys(value, ['type']) ? { type: 'close-popup' } : null
  }
  if (value.type === 'navigate') {
    return hasExactKeys(value, ['type', 'url']) &&
      typeof value.url === 'string' &&
      isCanonicalHttpsUrl(value.url)
      ? { type: 'navigate', url: value.url }
      : null
  }
  return null
}

const CONNECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Exact canonical lowercase RFC 4122 UUIDv4; no normalization. */
export function isConnectionId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTION_ID.test(value)
}

/** The value itself when it is an origin in canonical serialization. */
export function canonicalOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).origin === value ? value : null
  } catch {
    return null
  }
}

/** Either an explicit allowlist or any canonical HTTPS origin the browser observed. */
export type OriginAllowlist = readonly string[] | '*'

export function isAllowedOrigin(origin: string, allowlist: OriginAllowlist): boolean {
  if (allowlist === '*') return origin.startsWith('https://') && canonicalOrigin(origin) === origin
  return allowlist.includes(origin)
}

/**
 * A nonempty, duplicate-free set of canonical HTTPS origins, frozen.
 * Throws `TypeError` naming the option otherwise.
 */
export function requireOrigins(value: unknown, option: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${option} must list at least one origin`)
  }
  const origins = value.map((origin) => canonicalOrigin(origin))
  if (origins.some((origin) => origin === null || !origin.startsWith('https://'))) {
    throw new TypeError(`${option} must contain canonical HTTPS origins`)
  }
  if (new Set(origins).size !== origins.length) {
    throw new TypeError(`${option} must not repeat an origin`)
  }
  return Object.freeze(origins as string[])
}
