import { PROOF_LIFETIME_SECONDS_X, X } from '@libid/contracts/ceremony'

const token = X.token!,
  identity = X.identity!

/** Released v1 request profile plus browser-owned OAuth and presentation constraints. */
export const profile = {
  tokenUrl: `https://${token.session.authority}${token.session.path}`,
  tokenFields: token.tokenFields,
  identityUrl: `https://${identity.session.authority}${identity.session.path}`,
  idField: identity.idField,
  quotedId: identity.idShape === 'jsonString',
  userNameField: identity.handleField,
  // Released launch policy for retention; ledger verification remains authoritative.
  proofLifetimeSeconds: PROOF_LIFETIME_SECONDS_X,
  authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
  authorizationScope: 'tweet.read users.read',
  maxUserNameBytes: 15,
  identityHeaders: { Accept: 'application/json' },
} as const

export const isUserName = (value: string): boolean =>
  value.length <= profile.maxUserNameBytes && /^[A-Za-z0-9_]+$/.test(value)
