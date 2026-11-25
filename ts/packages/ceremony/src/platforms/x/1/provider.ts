import { X } from '@libid/contracts/ceremony'

const token = X.token!
const identity = X.identity!

/**
 * X's authorization code lifetime, measured 2026-11-20 by redeeming real codes at fixed ages from
 * X's redirect: accepted at 10, 15, 18, 21, 22, 23 and 24 s, refused at 25 and 40 s.
 */
const CODE_LIFETIME_SECONDS = 25

/** The released v1 request layout plus the browser-owned OAuth endpoint and scope. */
export const provider = {
  platform: X.platform,
  tokenUrl: `https://${token.session.authority}${token.session.path}`,
  tokenFields: token.tokenFields,
  identityUrl: `https://${identity.session.authority}${identity.session.path}`,
  idField: identity.idField,
  quotedId: identity.idShape === 'jsonString',
  userNameField: identity.handleField,
  authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
  authorizationScope: 'tweet.read users.read',
  identityHeaders: { Accept: 'application/json' },
  /**
   * X's answer to an expired code, measured 2026-11-20; a never-valid code gets the same answer,
   * and `invalid_request` alone names other failures too, so the description is matched as well.
   */
  expiredCode: {
    name: 'X',
    status: 400,
    error: 'invalid_request',
    description: 'Value passed for the authorization code was invalid.',
    lifetimeSeconds: CODE_LIFETIME_SECONDS,
  },
} as const
