import { bearerTranscript } from '../../../barretenberg/circuits/bearer-link/transcript.js'
import { isRecord } from '../../../primitives.js'
import { isUserName, profile } from './profile.js'

export const {
  identityUrl,
  buildTokenRequest,
  buildIdentityRequest,
  selectToken,
  selectIdentity,
  identityResponse,
} = bearerTranscript({
  tokenUrl: profile.tokenUrl,
  tokenFields(input) {
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
    }
    return profile.tokenFields.map((field) => [field, values[field]])
  },
  identityUrl: profile.identityUrl,
  identityHeaders: profile.identityHeaders,
  idField: profile.idField,
  quotedId: profile.quotedId,
  userName: { field: profile.userNameField, maxBytes: profile.maxUserNameBytes, valid: isUserName },
  identityResponse: ({ data }, { userId, userName }) =>
    isRecord(data) && data[profile.idField] === userId && data[profile.userNameField] === userName,
})
