import { isAuthorizationCode } from '../../../barretenberg/circuits/bearer-link/validation.js'
import { pkceAuthorizationUrlBuilder } from '../../authorization.js'
import type { ReturnRules } from '../../oauthReturn.js'
import { provider } from './provider.js'

export const pkce = true

/** Query code return; X defines no issuer field. */
export const returnRules: ReturnRules = {
  transport: 'query',
  credentialField: 'code',
  isCredential: isAuthorizationCode,
  rejected: ['id_token', 'access_token', 'refresh_token', 'iss'],
}

/** Build X v1's fixed public-client S256 authorization request. */
export const buildAuthorizationUrl = pkceAuthorizationUrlBuilder(
  provider.authorizationEndpoint,
  provider.authorizationScope,
  [['response_type', 'code']],
)
