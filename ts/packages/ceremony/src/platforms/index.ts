import type { IdentityProof } from '../ccdp/index.js'
import {
  validateIdentity as githubIdentity,
  validateProof as githubProof,
} from './github/1/types.js'
import * as githubUrl from './github/1/url.js'
import {
  validateIdentity as googleIdentity,
  validateProof as googleProof,
} from './google/1/types.js'
import * as googleUrl from './google/1/url.js'
import type { Identity } from './types.js'
import { validateIdentity as xIdentity, validateProof as xProof } from './x/1/types.js'
import * as xUrl from './x/1/url.js'

export type { Identity } from './types.js'

export const platforms = {
  google: {
    versions: { 1: { ...googleUrl, validateIdentity: googleIdentity, validateProof: googleProof } },
  },
  x: { versions: { 1: { ...xUrl, validateIdentity: xIdentity, validateProof: xProof } } },
  github: {
    versions: { 1: { ...githubUrl, validateIdentity: githubIdentity, validateProof: githubProof } },
  },
} as const

export type PlatformId = keyof typeof platforms

export type SupportedCeremonyVersion<P extends PlatformId> = P extends PlatformId
  ? keyof (typeof platforms)[P]['versions'] & number
  : never

export type ProofByPlatformVersion = {
  [P in PlatformId]: {
    [V in SupportedCeremonyVersion<P>]: (typeof platforms)[P]['versions'][V] extends {
      validateProof(value: unknown): infer Proof
    }
      ? Proof
      : never
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
      proof: ProofByPlatformVersion[K][V]
    }
  }[SupportedCeremonyVersion<K>]
}[P]

export type IdentityResult<P extends PlatformId = PlatformId> =
  | { [K in P]: { status: 'accepted'; identity: Identity<K>; oauthProof: OAuthProof<K> } }[P]
  | { status: 'denied' }

export function validateProofMessage<P extends PlatformId, V extends SupportedCeremonyVersion<P>>(
  platformId: P,
  version: V,
  message: IdentityProof,
): IdentityProof & { identity: Identity<P>; proof: ProofByPlatformVersion[P][V] } {
  const implementation = platforms[platformId]?.versions[version as 1]
  if (!implementation) throw new TypeError('Unsupported platform version')
  implementation.validateIdentity(message.identity)
  implementation.validateProof(message.proof)
  return message as IdentityProof & {
    identity: Identity<P>
    proof: ProofByPlatformVersion[P][V]
  }
}

export function assembleResult<P extends PlatformId>(
  platformId: P,
  version: SupportedCeremonyVersion<P>,
  message: IdentityProof,
  clientId: string,
  authorizationNonce: Uint8Array,
): IdentityResult<P> {
  const { identity, proof } = validateProofMessage(platformId, version, message)
  if (identity.oauthClientId !== clientId) throw new TypeError('OAuth client ID mismatch')
  return {
    status: 'accepted',
    identity,
    oauthProof: {
      platformCeremonyVersion: version,
      authorizationNonce: authorizationNonce.slice(),
      proof,
    },
  } as IdentityResult<P>
}

/** Enumerate the closed catalog/Bridge intersection in ascending version order. */
export function commonVersions<P extends PlatformId>(
  platform: P,
  advertised: readonly number[],
): readonly SupportedCeremonyVersion<P>[] {
  if (typeof platform !== 'string' || !Object.hasOwn(platforms, platform))
    throw new TypeError('Unsupported platform')
  return Object.freeze(
    Object.keys(platforms[platform].versions)
      .map(Number)
      .filter((v) => advertised.includes(v))
      .sort((a, b) => a - b),
  ) as readonly SupportedCeremonyVersion<P>[]
}

export function implementationFor<P extends PlatformId>(
  platform: P,
  version: SupportedCeremonyVersion<P>,
) {
  const implementation = platforms[platform].versions[version as 1]
  if (!implementation) throw new TypeError('Unsupported platform version')
  return implementation
}
