export * from './types.js'

export const platformId = 'x'

export const platformCeremonyVersion = 1

export const pkce = true

const AUTHORIZATION_ENDPOINT = 'https://x.com/i/oauth2/authorize'

const PKCE = /^[A-Za-z0-9_-]{43}$/

/** Build X v1's fixed public-client S256 authorization request. */
export function buildAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string | null
}): string {
  if (input.codeChallenge === null || !PKCE.test(input.codeChallenge)) {
    throw new Error('codeChallenge must be exactly 43 base64url characters')
  }
  const query = new URLSearchParams([
    ['response_type', 'code'],
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['scope', 'tweet.read users.read'],
    ['state', input.state],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  ])
  return `${AUTHORIZATION_ENDPOINT}?${query}`
}
