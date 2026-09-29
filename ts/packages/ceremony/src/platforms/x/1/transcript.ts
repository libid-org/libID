import { isPkceValue } from '../../../ccdp/index.js'
import { bearerTranscript, type TokenRequestInput } from '../../bearer-link/transcript.js'
import { isUserName } from './types.js'

export const { identityUrl, buildTokenRequest, buildIdentityRequest, selectToken, selectIdentity } =
  bearerTranscript({
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    tokenFields(input: TokenRequestInput) {
      if (!isPkceValue(input.codeVerifier))
        throw new Error('codeVerifier must be exactly 43 base64url characters')
      if (!input.clientId || !input.code || !input.redirectUri)
        throw new Error('X token request fields must be nonempty')
      return [
        ['grant_type', 'authorization_code'],
        ['client_id', input.clientId],
        ['code', input.code],
        ['redirect_uri', input.redirectUri],
        ['code_verifier', input.codeVerifier],
      ]
    },
    identityUrl: 'https://api.x.com/2/users/me',
    identityHeaders: { Accept: 'application/json' },
    quotedId: true,
    userName: { field: 'username', maxBytes: 15, valid: isUserName },
  })
