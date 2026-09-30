import { b64urlEncode } from '../../../primitives.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

/** Google carries the digest as the OIDC nonce; no PKCE (ceremony-common §5 table). */
export const pkce = false

/** Fragment-only ID-token return; a code or access token breaks Google v1's return rules. */
export const returnRules: ReturnRules = {
  transport: 'fragment',
  credentialField: 'id_token',
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
    ['scope', provider.authorizationScope],
    ['state', input.state],
    ['nonce', b64urlEncode(input.authorizationDigest)],
  ])
  return `${provider.authorizationEndpoint}?${query}`
}
