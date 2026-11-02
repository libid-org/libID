import { PLATFORM_GOOGLE } from '@libid/contracts/platforms'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'

/** Fixed oidc_google ABI in libid-circuits v0.8.0; changes require a matching circuit/key release. */
export const ISSUER = 'https://accounts.google.com'
/** The `email` and `sub` buffers: Google's platform table entry. */
export const MAX_EMAIL_BYTES = PLATFORM_GOOGLE.rules.maxLength
export const MAX_SUB_BYTES = PLATFORM_GOOGLE.idRules.maxLength
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

/** The audience hash, id node and handle node each take two 128-bit public fields. */
const HASH_FIELDS = 2

/** Digest bytes, the audience hash, both nodes, expiry and RSA modulus limbs (REQ-PLAT-16B). */
export const PUBLIC_INPUT_COUNT = AUTHORIZATION_DIGEST_BYTES + 3 * HASH_FIELDS + 1 + NUM_LIMBS
