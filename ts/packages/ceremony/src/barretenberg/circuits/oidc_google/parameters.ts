import { AUTHORIZATION_DIGEST_BYTES } from '../../../platforms/authorization.js'

/** Fixed oidc_google ABI in libid-circuits v0.4.0; changes require a matching circuit/key release. */
export const ISSUER = 'https://accounts.google.com'
export const FIELD_PACK_BYTES = 31
export const MAX_EMAIL_BYTES = 2 * FIELD_PACK_BYTES
export const MAX_SUB_BYTES = FIELD_PACK_BYTES
export const MAX_AUD_BYTES = 128
export const MAX_SIGNING_INPUT_BYTES = 1280
export const MAX_PAYLOAD_JSON_BYTES = 768
/** Base64url unsigned exponent 65537, required by the circuit. */
export const RSA_EXPONENT_BASE64URL = 'AQAB'
export const RSA_MODULUS_BYTES = 256
export const RSA_MODULUS_BITS = RSA_MODULUS_BYTES * 8
export const LIMB_BITS = 120n
export const NUM_LIMBS = Math.ceil(RSA_MODULUS_BITS / Number(LIMB_BITS))
export const BARRETT_OVERFLOW_BITS = 6n

/** SHA256 audience digest split into two 128-bit public fields. */
export const AUDIENCE_HASH_FIELDS = 2
export const AUDIENCE_HASH_FIELD_BYTES = 16

/** Digest bytes, audience hash, packed subject/email, expiry and RSA modulus limbs. */
export const PUBLIC_INPUT_COUNT =
  AUTHORIZATION_DIGEST_BYTES +
  AUDIENCE_HASH_FIELDS +
  Math.ceil(MAX_SUB_BYTES / FIELD_PACK_BYTES) +
  Math.ceil(MAX_EMAIL_BYTES / FIELD_PACK_BYTES) +
  1 +
  NUM_LIMBS
