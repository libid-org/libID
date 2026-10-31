import { isAuthorizationCode } from '../../../notary/oauth/validation.js'
import { isText } from '../../../primitives.js'
import { pkceAuthorizationUrlBuilder } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

/** The digest is bound by the OIDC nonce; PKCE only protects the code at the Bridge swap. */
export const pkce = true
export const digestBinding = 'nonce'

/** Query code return; a token in the redirect breaks the rules. */
export const returnRules: ReturnRules = {
  transport: 'query',
  credentialField: 'code',
  isCredential: (code) => isAuthorizationCode(code) && isText(code, provider.maxSwapFieldBytes),
  rejected: ['id_token', 'access_token', 'refresh_token'],
}

/** Build Telegram v1's S256 authorization request with the digest as its nonce. */
export const buildAuthorizationUrl = pkceAuthorizationUrlBuilder(
  provider.authorizationEndpoint,
  provider.authorizationScope,
  { leading: [['response_type', 'code']], nonce: digestBinding === 'nonce' },
)
