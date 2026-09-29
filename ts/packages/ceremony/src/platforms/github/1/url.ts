import { pkceAuthorizationUrl } from '../../authorization.js'
import type { ReturnProfile } from '../../oauthReturn.js'
import { profile } from './profile.js'

export const pkce = true

/** Query code return; success and error both carry the exact issuer. */
export const oauthReturn: ReturnProfile = {
  transport: 'query',
  credential: 'code',
  rejected: ['id_token', 'access_token', 'refresh_token'],
  issuer: profile.authorizationIssuer,
}

/** Build GitHub v1's fixed public authorization request. */
export const buildAuthorizationUrl = pkceAuthorizationUrl(
  profile.authorizationEndpoint,
  profile.authorizationScope,
)
