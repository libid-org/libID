import { isRecord } from '../../../primitives.js'
import { bearerTranscript } from '../../bearer-link/transcript.js'
import { isUserName } from './types.js'

export const {
  identityUrl,
  buildTokenRequest,
  buildIdentityRequest,
  selectToken,
  selectIdentity,
  identityResponse,
} = bearerTranscript({
  tokenUrl: 'https://api.x.com/2/oauth2/token',
  tokenFields: (input) => [
    ['grant_type', 'authorization_code'],
    ['client_id', input.clientId],
    ['code', input.code],
    ['redirect_uri', input.redirectUri],
    ['code_verifier', input.codeVerifier],
  ],
  identityUrl: 'https://api.x.com/2/users/me',
  identityHeaders: { Accept: 'application/json' },
  quotedId: true,
  userName: { field: 'username', maxBytes: 15, valid: isUserName },
  identityResponse: ({ data }, { userId, userName }) =>
    isRecord(data) && data.id === userId && data.username === userName,
})
