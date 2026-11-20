import { GITHUB } from '@libid/contracts/ceremony'

const token = GITHUB.token!
const identity = GITHUB.identity!

/**
 * GitHub's authorization code lifetime as GitHub documents it, 10 minutes; not yet measured with
 * real codes.
 */
const CODE_LIFETIME_SECONDS = 600

/** The released v1 request layout plus the browser-owned OAuth endpoint and scope. */
export const provider = {
  platform: GITHUB.platform,
  tokenUrl: `https://${token.session.authority}${token.session.path}`,
  tokenFields: token.tokenFields,
  identityUrl: `https://${identity.session.authority}${identity.session.path}`,
  idField: identity.idField,
  quotedId: identity.idShape === 'jsonString',
  userNameField: identity.handleField,
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  authorizationIssuer: 'https://github.com/login/oauth',
  authorizationScope: 'read:user',
  identityHeaders: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Mozilla/5.0',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  /**
   * GitHub's answer to an incorrect or expired code, sent with a 200, measured 2026-11-20 with a
   * never-valid code ("The code passed is incorrect or expired.").
   */
  expiredCode: {
    name: 'GitHub',
    status: 200,
    error: 'bad_verification_code',
    lifetimeSeconds: CODE_LIFETIME_SECONDS,
  },
} as const
