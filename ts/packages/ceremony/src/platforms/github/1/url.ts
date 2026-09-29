import { isPkceValue } from '../../../ccdp/index.js'

export const pkce = true

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
