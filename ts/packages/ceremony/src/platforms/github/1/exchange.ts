import { bearerExchange } from '../../../barretenberg/circuits/bearer-link/exchange.js'
import { isClientCredential } from '../../../ccdp/index.js'
import { provider } from './provider.js'
import { isUserName, MAX_USER_NAME_BYTES } from './validation.js'

export const {
  identityUrl,
  buildTokenRequest,
  buildIdentityRequest,
  selectToken,
  selectIdentity,
  identityResponse,
} = bearerExchange({
  tokenUrl: provider.tokenUrl,
  tokenFields(input) {
    if (!isClientCredential(input.clientCredential)) throw new Error('Invalid token request')
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_secret: input.clientCredential,
    }
    return provider.tokenFields.map((field) => [field, values[field]])
  },
  identityUrl: provider.identityUrl,
  identityHeaders: provider.identityHeaders,
  idField: provider.idField,
  quotedId: provider.quotedId,
  userName: {
    field: provider.userNameField,
    maxBytes: MAX_USER_NAME_BYTES,
    valid: isUserName,
  },
  // The exact decimal ID exceeds JSON number precision; the selector owns its bytes.
  // JSON checks the root shape; the depth-agnostic byte selector preserves the exact ID.
  identityResponse: (body, { userName }) =>
    typeof body[provider.idField] === 'number' && body[provider.userNameField] === userName,
})
