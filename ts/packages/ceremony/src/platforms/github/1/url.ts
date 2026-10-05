import { isAuthorizationCode } from '../../../notary/oauth/validation.js'
import { pkceAuthorizationUrlBuilder } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

export const pkce = true

/** Query code return; success and error both carry the exact issuer. */
export const returnRules: ReturnRules = {
  transport: 'query',
  credentialField: 'code',
  isCredential: isAuthorizationCode,
  rejected: ['id_token', 'access_token', 'refresh_token'],
  authorizationIssuer: provider.authorizationIssuer,
}

/** Build GitHub v1's fixed public authorization request. */
export const buildAuthorizationUrl = pkceAuthorizationUrlBuilder(
  provider.authorizationEndpoint,
  provider.authorizationScope,
)
