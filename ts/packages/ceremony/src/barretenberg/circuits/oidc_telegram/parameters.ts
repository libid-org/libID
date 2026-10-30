import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { NUM_LIMBS } from '../oidc_google/parameters.js'

/** Fixed oidc_telegram ABI of libid-circuits' circuits/oidc-telegram/src/main.nr. */
export const MAX_SIGNING_INPUT_BYTES = 2688
export const MAX_AUD_BYTES = 20
export const MAX_IAT_DIGITS = 12
/** The issuer claim as Telegram signs it, `/` escaped. */
export const ISSUER_CLAIM = '"iss":"https:\\/\\/oauth.telegram.org"'

/** Each claim's window of whole 3-byte payload groups. */
export const WINDOWS = {
  iss: 39,
  aud: 33,
  iat: 21,
  id: 30,
  username: 60,
  nonce: 57,
} as const

/** The audience hash, id node and handle node each take two 128-bit public fields. */
const HASH_FIELDS = 2

/** Digest bytes, the audience hash, both nodes, iat and RSA modulus limbs. */
export const PUBLIC_INPUT_COUNT = AUTHORIZATION_DIGEST_BYTES + 3 * HASH_FIELDS + 1 + NUM_LIMBS
