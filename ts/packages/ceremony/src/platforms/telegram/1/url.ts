import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { isAuthorizationCode } from '../../../notary/oauth/validation.js'
import { b64urlEncode } from '../../../primitives.js'
import { isPkceValue } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

/** Telegram carries the digest as the OIDC nonce and the code exchange its PKCE verifier. */
export const pkce = true

/** Query code return; a token in the redirect breaks the rules. */
export const returnRules: ReturnRules = {
  transport: 'query',
  credentialField: 'code',
  isCredential: isAuthorizationCode,
  rejected: ['id_token', 'access_token', 'refresh_token'],
}

/** The authorization request: these eight fields, in this order, form-urlencoded. */
export function buildAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  authorizationDigest: Uint8Array
  codeChallenge: string | null
}): string {
  if (input.authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES)
    throw new Error('authorizationDigest must be exactly 32 bytes')
  if (!isPkceValue(input.codeChallenge))
    throw new Error('codeChallenge must be exactly 43 base64url characters')
  const query = new URLSearchParams([
    ['response_type', 'code'],
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['scope', provider.authorizationScope],
    ['state', input.state],
    ['nonce', b64urlEncode(input.authorizationDigest)],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  ])
  return `${provider.authorizationEndpoint}?${query}`
}
