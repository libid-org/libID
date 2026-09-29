import { isClientCredential } from '../../../ccdp/index.js'
import { bearerTranscript } from '../../bearer-transcript.js'
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
    if (!isClientCredential(input.clientCredential)) throw new Error('Invalid token request')
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_secret: input.clientCredential,
    }
    return profile.tokenFields.map((field) => [field, values[field]])
  },
  identityUrl: profile.identityUrl,
  identityHeaders: profile.identityHeaders,
  idField: profile.idField,
  quotedId: profile.quotedId,
  userName: { field: profile.userNameField, maxBytes: profile.maxUserNameBytes, valid: isUserName },
  // The exact decimal ID exceeds JSON number precision; the selector owns its bytes.
  // JSON checks the root shape; the depth-agnostic byte selector preserves the exact ID.
  identityResponse: (body, { userName }) =>
    typeof body[profile.idField] === 'number' && body[profile.userNameField] === userName,
})
