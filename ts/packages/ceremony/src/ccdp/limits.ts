/** Platform ceremony versions are unsigned 16-bit: the authorization digest's U16BE field. */
export const MAX_CEREMONY_VERSION = 0xffff

/** UTF-8 bound on displayable failure text, including `CeremonyFailed.message`. */
export const MAX_FAILURE_TEXT_BYTES = 2048

/** UTF-8 bounds shared by CCDP codecs and platform admission. */
export const MAX_CLIENT_ID_BYTES = 512
export const MAX_CLIENT_CREDENTIAL_BYTES = MAX_CLIENT_ID_BYTES
export const MAX_IDENTITY_TEXT_BYTES = 255
export const MAX_REDIRECT_URI_BYTES = 2048

/** Encoded navigation fragment string limit, before URLSearchParams decoding. */
export const MAX_NAVIGATION_FRAGMENT_CHARS = 65536

/** Callback URL components including ?/#, measured before platform decoding. */
export const MAX_OAUTH_RETURN_CHARS = 32768
