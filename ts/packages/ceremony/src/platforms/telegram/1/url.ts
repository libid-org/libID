import { isAuthorizationCode } from '../../../notary/oauth/validation.js'
import { pkceAuthorizationUrlBuilder } from '../../authorization.js'
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

/** Build Telegram v1's S256 authorization request with the digest as its nonce. */
export const buildAuthorizationUrl = pkceAuthorizationUrlBuilder(
  provider.authorizationEndpoint,
  provider.authorizationScope,
  [['response_type', 'code']],
  true,
)
