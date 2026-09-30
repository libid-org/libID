import { bearerExchange } from '../../../barretenberg/circuits/bearer-link/exchange.js'
import { isRecord } from '../../../primitives.js'
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
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
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
  identityResponse: ({ data }, { userId, userName }) =>
    isRecord(data) &&
    data[provider.idField] === userId &&
    data[provider.userNameField] === userName,
})
