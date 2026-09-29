import { pkceAuthorizationUrl } from '../../authorization.js'
import type { ReturnProfile } from '../../oauthReturn.js'

export const pkce = true

/** Query code return; X defines no issuer field. */
export const oauthReturn: ReturnProfile = {
  transport: 'query',
  credential: 'code',
  rejected: ['id_token', 'access_token', 'refresh_token', 'iss'],
}

/** Build X v1's fixed public-client S256 authorization request. */
export const buildAuthorizationUrl = pkceAuthorizationUrl(
  'https://x.com/i/oauth2/authorize',
  'tweet.read users.read',
  [['response_type', 'code']],
)
