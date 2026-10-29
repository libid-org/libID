/** Telegram v1's OIDC endpoints and the Bridge routes that hold its confidential client. */
export const provider = {
  authorizationEndpoint: 'https://oauth.telegram.org/auth',
  authorizationScope: 'openid profile',
  issuer: 'https://oauth.telegram.org',
  tokenPath: '/api/v1/ceremony/telegram/token',
  jwksPath: '/api/v1/ceremony/telegram/jwks',
} as const
