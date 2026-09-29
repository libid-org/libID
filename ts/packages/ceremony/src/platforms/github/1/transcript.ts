import { isClientCredential, redirect } from '../../../ccdp/index.js'
import { isFormClientId } from '../../authorization.js'
import {
  type TokenRequestInput as BaseTokenRequestInput,
  bearerTranscript,
} from '../../bearer-link/transcript.js'
import { isUserName } from './types.js'

export interface TokenRequestInput extends BaseTokenRequestInput {
  clientCredential: string
}

export const { identityUrl, buildTokenRequest, buildIdentityRequest, selectToken, selectIdentity } =
  bearerTranscript({
    tokenUrl: 'https://github.com/login/oauth/access_token',
    tokenFields(input: TokenRequestInput) {
      if (
        !isFormClientId(input.clientId) ||
        !/^[\x21-\x7e]{1,1024}$/.test(input.code) ||
        !redirect(input.redirectUri) ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.codeVerifier) ||
        !isClientCredential(input.clientCredential)
      )
        throw new Error('Invalid GitHub token request')
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
  })
