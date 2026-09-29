/** UTF-8 bounds shared by CCDP codecs and platform admission. */
export const MAX_CLIENT_ID_BYTES = 512
export const MAX_CLIENT_CREDENTIAL_BYTES = MAX_CLIENT_ID_BYTES
export const MAX_IDENTITY_TEXT_BYTES = 255
export const MAX_REDIRECT_URI_BYTES = 2048

/** Encoded navigation fragment string limit, before URLSearchParams decoding. */
export const MAX_NAVIGATION_FRAGMENT_CHARS = 65536

/** Callback URL components including ?/#, measured before platform decoding. */
export const MAX_OAUTH_RETURN_CHARS = 32768
