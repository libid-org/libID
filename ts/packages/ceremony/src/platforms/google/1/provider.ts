import { ISSUER } from '../../../barretenberg/circuits/oidc_google/parameters.js'

/** Google v1's code-owned OAuth endpoints and the issuer pinned by its circuit. */
export const provider = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  authorizationScope: 'openid email',
  issuer: ISSUER,
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
} as const
