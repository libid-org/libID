import * as bearerLinkEvents from '../barretenberg/circuits/bearer-link/events.js'
import type { IdentityProof } from '../ccdp/index.js'
import * as githubUrl from './github/1/url.js'
import * as github from './github/1/validation.js'
import * as googleEvents from './google/1/events.js'
import * as googleUrl from './google/1/url.js'
import * as google from './google/1/validation.js'
import type { Identity } from './types.js'
import * as xUrl from './x/1/url.js'
import * as x from './x/1/validation.js'

export type { Identity } from './types.js'

/** Validate each version's proof before deriving its retention metadata. */
const resultAdapter = <I, P>(validation: {
  validateIdentity(value: unknown): I
  validateProof(value: unknown, identity: I, authorizationDigest: Uint8Array): P
  proofExpiresAt(proof: P): number
}) => ({
  acceptResult(identityValue: unknown, proofValue: unknown, authorizationDigest: Uint8Array) {
    const identity = validation.validateIdentity(identityValue)
    const proof = validation.validateProof(proofValue, identity, authorizationDigest)
    return { identity, proof, expiresAt: validation.proofExpiresAt(proof) }
  },
})

export const platforms = {
  google: {
    requiresClientCredential: false,
    isClientId: google.isClientId,
    versions: { 1: { ...googleUrl, ...googleEvents, ...resultAdapter(google) } },
  },
  x: {
    requiresClientCredential: false,
    isClientId: x.isClientId,
    versions: { 1: { ...xUrl, ...bearerLinkEvents, ...resultAdapter(x) } },
  },
  github: {
    requiresClientCredential: true,
    isClientId: github.isClientId,
    versions: { 1: { ...githubUrl, ...bearerLinkEvents, ...resultAdapter(github) } },
  },
} as const

export type PlatformId = keyof typeof platforms

export const isPlatformId = (value: unknown): value is PlatformId =>
  typeof value === 'string' && Object.hasOwn(platforms, value)

export type SupportedCeremonyVersion<P extends PlatformId> = P extends PlatformId
  ? keyof (typeof platforms)[P]['versions'] & number
  : never

export type ProofByPlatformVersion = {
  [P in PlatformId]: {
    [V in SupportedCeremonyVersion<P>]: ReturnType<
      (typeof platforms)[P]['versions'][V]['acceptResult']
    >['proof']
  }
}

export const supportedPlatforms: readonly PlatformId[] = Object.freeze(
  Object.keys(platforms) as PlatformId[],
)

export type OAuthProof<P extends PlatformId = PlatformId> = {
  [K in P]: {
    [V in SupportedCeremonyVersion<K>]: {
      platformCeremonyVersion: V
      authorizationNonce: Uint8Array
      /** The client-derived, 32-byte digest binding this proof to its ledger operation. */
      authorizationDigest: Uint8Array
      proof: ProofByPlatformVersion[K][V]
      /** Unix seconds; unusable at block time >= expiresAt. Retention only, not verification. */
      expiresAt: number
    }
  }[SupportedCeremonyVersion<K>]
}[P]

export type IdentityResult<P extends PlatformId = PlatformId> =
  | { [K in P]: { status: 'accepted'; identity: Identity<K>; oauthProof: OAuthProof<K> } }[P]
  | { status: 'denied' }

export function assembleResult<P extends PlatformId>(
  platformId: P,
  version: SupportedCeremonyVersion<P>,
  message: IdentityProof,
  clientId: string,
  authorizationNonce: Uint8Array,
  authorizationDigest: Uint8Array,
): IdentityResult<P> {
  const { identity, proof, expiresAt } = ceremonyFor(platformId, version).acceptResult(
    message.identity,
    message.proof,
    authorizationDigest,
  )
  if (identity.oauthClientId !== clientId) throw new TypeError('OAuth client ID mismatch')
  return {
    status: 'accepted',
    identity,
    oauthProof: {
      platformCeremonyVersion: version,
      authorizationNonce: authorizationNonce.slice(),
      authorizationDigest: authorizationDigest.slice(),
      proof,
      expiresAt,
    },
  } as IdentityResult<P>
}

/** The catalog's versions of `platform` that `available` names, in ascending order. */
export function commonVersions<P extends PlatformId>(
  platform: P,
  available: readonly number[],
): readonly SupportedCeremonyVersion<P>[] {
  if (!isPlatformId(platform)) throw new TypeError('Unsupported platform')
  return Object.freeze(
    Object.keys(platforms[platform].versions)
      .map(Number)
      .filter((v) => available.includes(v))
      .sort((a, b) => a - b),
  ) as readonly SupportedCeremonyVersion<P>[]
}

/**
 * Platform `P`'s ceremony at `version`: its authorization request, return rules, events and result
 * adapter. Its prover is registered apart, in `provers.ts`, so the Client never bundles one.
 */
export function ceremonyFor<P extends PlatformId>(
  platform: P,
  version: SupportedCeremonyVersion<P>,
) {
  const ceremony = platforms[platform].versions[version as 1]
  if (!ceremony) throw new TypeError('Unsupported platform version')
  return ceremony
}
