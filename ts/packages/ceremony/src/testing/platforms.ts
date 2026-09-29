// Catalog-driven platform test inputs. Iterate `supportedPlatforms` and read the conformance
// table instead of naming platforms, so a catalog addition reaches every such test.
import type { PlatformConfig } from '../ccdp/client/config.js'
import type { ProveIdentity } from '../ccdp/index.js'
import { oauthState } from '../ccdp/navigation.js'
import { fixtures } from '../platforms/conformance/fixtures.js'
import type { ProverContext } from '../platforms/context.js'
import { type PlatformId, platforms, supportedPlatforms } from '../platforms/index.js'
import { CEREMONY_ID } from './index.js'

export {
  fixtures,
  googlePublicInputs,
  googleV1,
  jwtPart,
  jwtWith,
  type PlatformFixture,
} from '../platforms/conformance/fixtures.js'

type Pipeline<K extends string> = {
  [P in PlatformId]: (typeof fixtures)[P] extends { pipeline: K } ? P : never
}[PlatformId]

export type BearerLinkPlatform = Pipeline<'bearer-link'>

export type OidcPlatform = Pipeline<'oidc'>

/** Catalog platforms proven by the shared bearer-link pipeline, in catalog order. */
export const bearerLinkPlatforms = supportedPlatforms.filter(
  (p): p is BearerLinkPlatform => fixtures[p].pipeline === 'bearer-link',
)

/** Catalog platforms proven from a signed OIDC ID token, in catalog order. */
export const oidcPlatforms = supportedPlatforms.filter(
  (p): p is OidcPlatform => fixtures[p].pipeline === 'oidc',
)

/** The fixture client as one Bridge-advertised version-1 configuration entry. */
export const platformConfig = (platformId: PlatformId): PlatformConfig => ({
  ...fixtures[platformId].config,
  ceremonyVersions: [1],
})

/** The fixture's provider returns, bound to CEREMONY_ID. */
export const returnSamples = (platformId: PlatformId) =>
  fixtures[platformId].returns(oauthState(CEREMONY_ID))

/** A valid ProveIdentity for the fixture client, with the verifier the catalog's PKCE choice needs. */
export function proveIdentity(
  platformId: PlatformId = 'google',
  change: Partial<ProveIdentity> = {},
): ProveIdentity {
  return {
    type: 'prove-identity',
    platformId,
    platformCeremonyVersion: 1,
    ...fixtures[platformId].config,
    redirectUri: 'https://bridge.test/auth/callback',
    // Canonical base64url of 32 zero bytes.
    codeVerifier: platforms[platformId].versions[1].pkce ? 'A'.repeat(43) : null,
    notaryAddress: 'https://notary.test',
    ...change,
  }
}

/** A ProverContext for the fixture's accepted return under CEREMONY_ID. */
export function proverContext(
  platformId: PlatformId,
  change: Partial<Omit<ProverContext, 'request'>> & { request?: Partial<ProveIdentity> } = {},
): ProverContext {
  const { request, ...rest } = change
  return {
    ceremonyId: CEREMONY_ID,
    signal: new AbortController().signal,
    emit: () => {},
    oauthReturn: returnSamples(platformId).accepted.oauthReturn,
    request: proveIdentity(platformId, request),
    ...rest,
  }
}
