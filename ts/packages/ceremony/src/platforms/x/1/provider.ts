import { X } from '@libid/contracts/ceremony'

const token = X.token!
const identity = X.identity!

/** The released v1 request layout plus the browser-owned OAuth endpoint and scope. */
export const provider = {
  tokenUrl: `https://${token.session.authority}${token.session.path}`,
  tokenFields: token.tokenFields,
  identityUrl: `https://${identity.session.authority}${identity.session.path}`,
  idField: identity.idField,
  quotedId: identity.idShape === 'jsonString',
  userNameField: identity.handleField,
  authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
  authorizationScope: 'tweet.read users.read',
  identityHeaders: { Accept: 'application/json' },
} as const
