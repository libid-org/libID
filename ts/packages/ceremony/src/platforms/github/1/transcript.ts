import { isClientCredential } from '../../../ccdp/index.js'
import { bearerTranscript } from '../../bearer-transcript.js'
import { isUserName } from './types.js'

export const {
  identityUrl,
  buildTokenRequest,
  buildIdentityRequest,
  selectToken,
  selectIdentity,
  identityResponse,
} = bearerTranscript({
  tokenUrl: 'https://github.com/login/oauth/access_token',
  tokenFields(input) {
    if (!isClientCredential(input.clientCredential)) throw new Error('Invalid token request')
    return [
      ['client_id', input.clientId],
      ['code', input.code],
      ['redirect_uri', input.redirectUri],
      ['code_verifier', input.codeVerifier],
      ['client_secret', input.clientCredential],
    ]
  },
  identityUrl: 'https://api.github.com/user',
  identityHeaders: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Mozilla/5.0',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  quotedId: false,
  userName: { field: 'login', maxBytes: 39, valid: isUserName },
  // The exact decimal ID exceeds JSON number precision; the selector owns its bytes.
  // JSON checks the root shape; the depth-agnostic byte selector preserves the exact ID.
  identityResponse: (body, { userName }) => typeof body.id === 'number' && body.login === userName,
})
