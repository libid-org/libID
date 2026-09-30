// Catalog-driven platform test inputs. Iterate `supportedPlatforms` and read the conformance
// table instead of naming platforms, so a catalog addition reaches every such test.
import type { PlatformConfig } from '../ccdp/client/config.js'
import { validatePlatformVersions } from '../ccdp/client/versions.js'
import type { ProveIdentity } from '../ccdp/index.js'
import { oauthState } from '../ccdp/navigation.js'
import { fixtures } from '../platforms/conformance/fixtures.js'
import type { ProverContext } from '../platforms/context.js'
import { type PlatformId, platforms, supportedPlatforms } from '../platforms/index.js'
import { CEREMONY_ID } from './values.js'

export {
  fixtures,
  googlePublicInputs,
  googleV1,
  jwtPart,
  jwtWith,
} from '../platforms/conformance/fixtures.js'

type OfProverKind<K extends string> = {
  [P in PlatformId]: (typeof fixtures)[P] extends { proverKind: K } ? P : never
}[PlatformId]

export type BearerLinkPlatform = OfProverKind<'bearer-link'>

export type OidcPlatform = OfProverKind<'oidc'>

/** Catalog platforms proven by the shared bearer-link prover, in catalog order. */
export const bearerLinkPlatforms = supportedPlatforms.filter(
  (p): p is BearerLinkPlatform => fixtures[p].proverKind === 'bearer-link',
)

/** Catalog platforms proven from a signed OIDC ID token, in catalog order. */
export const oidcPlatforms = supportedPlatforms.filter(
  (p): p is OidcPlatform => fixtures[p].proverKind === 'oidc',
)

/** A Distribution list bundling every catalog version, as the Prover the build emits does. */
export const bundledVersions = validatePlatformVersions(
  Object.fromEntries(
    supportedPlatforms.map((platformId) => [
      platformId,
      Object.keys(platforms[platformId].versions).map(Number),
    ]),
  ),
)

/** The fixture OAuth client registration supplied by the Bridge. */
export const platformConfig = (platformId: PlatformId): PlatformConfig => ({
  ...fixtures[platformId].config,
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

/** The Prover document's capture of the fixture's accepted return under CEREMONY_ID. */
export const returnCapture = (
  platformId: PlatformId,
  outcome: 'accepted' | 'denied' = 'accepted',
) => ({
  ceremonyId: CEREMONY_ID,
  oauthReturn: returnSamples(platformId)[outcome].oauthReturn,
})

/** A ProverContext as the Prover document builds it from the fixture's accepted return. */
export function proverContext(
  platformId: PlatformId,
  change: Partial<Omit<ProverContext, 'request'>> & { request?: Partial<ProveIdentity> } = {},
): ProverContext {
  const { request: requestChange, ...rest } = change
  const request = proveIdentity(platformId, requestChange)
  return {
    signal: new AbortController().signal,
    emit: () => {},
    credential: returnSamples(platformId).accepted.credential,
    codeVerifier: request.codeVerifier,
    request,
    ...rest,
  }
}
