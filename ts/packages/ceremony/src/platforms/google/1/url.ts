export * from './types.js'

import { b64urlEncode } from '../../../primitives.js'

export const platformId = 'google'

export const platformCeremonyVersion = 1

/** Google carries the digest as the OIDC nonce; no PKCE (spec §5 table). */
export const pkce = false

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * The §3.1 authorization request: seven fields, exactly this order,
 * serialized by the WHATWG form-urlencoded serializer (REQ-COMMON-07/-08 —
 * `URLSearchParams` implements it). The nonce is the base64url encoding of
 * the 32 digest bytes (REQ-PLAT-10).
 */
export function buildAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  authorizationDigest: Uint8Array
}): string {
  if (input.authorizationDigest.length !== 32) {
    throw new Error('authorizationDigest must be exactly 32 bytes')
  }
  const query = new URLSearchParams([
    ['response_type', 'id_token'],
    ['response_mode', 'fragment'],
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['scope', 'openid email'],
    ['state', input.state],
    ['nonce', b64urlEncode(input.authorizationDigest)],
  ])
  return `${AUTHORIZATION_ENDPOINT}?${query}`
}
