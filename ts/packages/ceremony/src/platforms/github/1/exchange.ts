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
  isIdentityResponse,
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
  // The byte selector owns the exact decimal ID. JSON may round a large one, but `Number()`
  // rounds the selected decimal identically, so the parsed root value still cross-checks it.
  isIdentityResponse: (body, { userId, userName }) =>
    body[provider.idField] === Number(userId) && body[provider.userNameField] === userName,
})
