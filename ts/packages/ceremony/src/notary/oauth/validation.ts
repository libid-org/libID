// Rules for what the OAuth requests carry; catalog-safe, without the notary runtime.

/** A bounded field: its byte bound and grammar. */
export interface Bounded {
  maxBytes: number
  valid(value: string): boolean
}

/** Form-authenticated client IDs must be byte-identical under form serialization. */
export const isFormClientId = (value: string): boolean => /^[A-Za-z0-9*._-]+$/.test(value)

// A consumed redirect code that fits one header-free form field of the bounded sent transcript.
export const MAX_CODE_CHARS = 1024

/** An authorization code the token request can carry: visible ASCII within its field bound. */
export const isAuthorizationCode = (value: string): boolean =>
  value.length <= MAX_CODE_CHARS && /^[\x21-\x7e]+$/.test(value)
