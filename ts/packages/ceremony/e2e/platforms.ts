// Data only: the harness server imports this table through Node type stripping.
import type { PlatformId } from '../src/platforms/index.js'

/**
 * One catalog platform's controlled browser fixtures. Provider facts are stated here,
 * independently of the catalog's own return rules, so changed rules fail the suite.
 */
export interface BrowserPlatform {
  /** Registration the harness Bridge advertises. */
  clientId: string
  clientCredential?: string
  /** Authorization endpoint the popup must reach, and how the provider returns to Callback. */
  authorization: string
  returns: 'query' | 'fragment'
  authorizationIssuer?: string
  /** Whether the authorization request carries an S256 PKCE challenge. */
  pkce: boolean
  /** `jwt`: the signed Google v1 fixture token; `tlsn`: the notarized flow with a fixture TLSN SDK/peer. */
  evidence: 'jwt' | 'tlsn'
  /** One real-notary runtime test per entry; `alongsideProving` also proves in that runtime. */
  notary: readonly { sessions: number; alongsideProving?: true }[]
}

// A catalog platform without an entry, or an entry outside the catalog, fails typecheck:e2e.
const table = {
  google: {
    clientId: '407408718192.apps.googleusercontent.com',
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
    returns: 'fragment',
    pkce: false,
    evidence: 'jwt',
    notary: [],
  },
  x: {
    clientId: 'x-fixture',
    authorization: 'https://x.com/i/oauth2/authorize',
    returns: 'query',
    pkce: true,
    evidence: 'tlsn',
    notary: [{ sessions: 1 }, { sessions: 2 }],
  },
  github: {
    clientId: 'github-fixture',
    clientCredential: 'fixture-public-credential',
    authorization: 'https://github.com/login/oauth/authorize',
    returns: 'query',
    authorizationIssuer: 'https://github.com/login/oauth',
    pkce: true,
    evidence: 'tlsn',
    notary: [{ sessions: 2, alongsideProving: true }],
  },
} as const satisfies { [P in PlatformId]: BrowserPlatform }

export const browserPlatforms: { readonly [P in PlatformId]: BrowserPlatform } = table

export const platformIds = Object.keys(table) as PlatformId[]

/** Platforms with real notary sessions; each needs an unauthenticated request in runtime.ts. */
export type NotaryPlatform = {
  [P in PlatformId]: (typeof table)[P]['notary'] extends readonly [] ? never : P
}[PlatformId]

/** Every real-notary runtime case, in table order. */
export const notaryCases = platformIds.flatMap((platform) =>
  browserPlatforms[platform].notary.map(({ sessions, alongsideProving }) => ({
    platform: platform as NotaryPlatform,
    sessions,
    alongsideProving: alongsideProving === true,
  })),
)
