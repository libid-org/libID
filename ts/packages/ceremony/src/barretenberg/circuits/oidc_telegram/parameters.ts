/** Fixed oidc_telegram ABI of libid-circuits' circuits/oidc-telegram/src/main.nr. */
export const MAX_SIGNING_INPUT_BYTES = 2688
export const MAX_AUD_BYTES = 20
export const MAX_IAT_DIGITS = 12
export const ISSUER = 'https://oauth.telegram.org'
/** The issuer claim as Telegram signs it, `/` escaped. */
export const ISSUER_CLAIM = `"iss":"${ISSUER.replaceAll('/', '\\/')}"`

/** Each claim's window of whole 3-byte payload groups. */
export const WINDOWS = {
  iss: 39,
  aud: 33,
  iat: 21,
  id: 30,
  username: 60,
  nonce: 57,
} as const
