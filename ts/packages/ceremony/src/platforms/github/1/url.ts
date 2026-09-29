import { isPkceValue } from '../../../ccdp/index.js'
import type { ReturnProfile } from '../../oauthReturn.js'

export const pkce = true

/** Query code return; success and error both carry the exact issuer. */
export const oauthReturn: ReturnProfile = {
  transport: 'query',
  credential: 'code',
  rejected: ['id_token', 'access_token', 'refresh_token'],
  issuer: 'https://github.com/login/oauth',
}

const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize'

/** Build GitHub v1's fixed public authorization request. */
export function buildAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string | null
}): string {
  if (input.codeChallenge === null || !isPkceValue(input.codeChallenge)) {
    throw new Error('codeChallenge must be exactly 43 base64url characters')
  }
  const query = new URLSearchParams([
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['scope', 'read:user'],
    ['state', input.state],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  ])
  return `${AUTHORIZATION_ENDPOINT}?${query}`
}
