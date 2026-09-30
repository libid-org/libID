import { GITHUB } from '@libid/contracts/ceremony'

const token = GITHUB.token!,
  identity = GITHUB.identity!

/** The released v1 request layout plus the browser-owned OAuth endpoint and scope. */
export const provider = {
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
} as const
