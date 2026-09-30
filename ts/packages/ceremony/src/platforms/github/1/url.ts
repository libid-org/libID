import { pkceAuthorizationUrl } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

export const pkce = true

/** Query code return; success and error both carry the exact issuer. */
export const oauthReturn: ReturnRules = {
  transport: 'query',
  credential: 'code',
  rejected: ['id_token', 'access_token', 'refresh_token'],
  issuer: provider.authorizationIssuer,
}

/** Build GitHub v1's fixed public authorization request. */
export const buildAuthorizationUrl = pkceAuthorizationUrl(
  provider.authorizationEndpoint,
  provider.authorizationScope,
)
