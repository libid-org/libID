import { GITHUB, PROOF_LIFETIME_SECONDS_GITHUB } from '@libid/contracts/ceremony'

const token = GITHUB.token!,
  identity = GITHUB.identity!

/** Released v1 request layout plus browser-owned OAuth and presentation constraints. */
export const provider = {
  tokenUrl: `https://${token.session.authority}${token.session.path}`,
  tokenFields: token.tokenFields,
  identityUrl: `https://${identity.session.authority}${identity.session.path}`,
  idField: identity.idField,
  quotedId: identity.idShape === 'jsonString',
  userNameField: identity.handleField,
  // Released launch policy for retention; ledger verification remains authoritative.
  proofLifetimeSeconds: PROOF_LIFETIME_SECONDS_GITHUB,
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  authorizationIssuer: 'https://github.com/login/oauth',
  authorizationScope: 'read:user',
  identityHeaders: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Mozilla/5.0',
    'X-GitHub-Api-Version': '2022-11-28',
  },
} as const
