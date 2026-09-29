import { b64urlEncode } from '../../../primitives.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../authorization.js'
import type { ReturnProfile } from '../../oauthReturn.js'
import { profile } from './profile.js'

/** Google carries the digest as the OIDC nonce; no PKCE (spec §5 table). */
export const pkce = false

/** Fragment-only ID-token return; a code or access token violates the profile. */
export const oauthReturn: ReturnProfile = {
  transport: 'fragment',
  credential: 'id_token',
  rejected: ['code', 'access_token', 'refresh_token'],
}

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
  if (input.authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES) {
    throw new Error('authorizationDigest must be exactly 32 bytes')
  }
  const query = new URLSearchParams([
    ['response_type', 'id_token'],
    ['response_mode', 'fragment'],
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['scope', profile.authorizationScope],
    ['state', input.state],
    ['nonce', b64urlEncode(input.authorizationDigest)],
  ])
  return `${profile.authorizationEndpoint}?${query}`
}
