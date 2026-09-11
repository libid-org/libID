import type { ProverIdentityProof } from '../ccdp/index.js'
import * as githubV1 from './github/1/url.js'
import * as googleV1 from './google/1/url.js'
import type { Identity } from './types.js'
import * as xV1 from './x/1/url.js'

export type { Identity, NotaryAttestation } from './types.js'

export const platforms = {
  google: { versions: { 1: googleV1 } },
  x: { versions: { 1: xV1 } },
  github: { versions: { 1: githubV1 } },
} as const

export type PlatformId = keyof typeof platforms

export type PlatformCeremonyVersion = number

export type SupportedCeremonyVersion<P extends PlatformId> =
  keyof (typeof platforms)[P]['versions'] & number

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
  message: ProverIdentityProof,
): ProverIdentityProof & { identity: Identity<P>; proof: ProofByPlatformVersion[P][V] } {
  const implementation = platforms[platformId]?.versions[version as 1]
  if (!implementation) throw new TypeError('Unsupported platform version')
  implementation.validateIdentity(message.identity)
  implementation.validateProof(message.proof)
  return message as ProverIdentityProof & {
    identity: Identity<P>
    proof: ProofByPlatformVersion[P][V]
  }
}

export function assembleResult<P extends PlatformId>(
  platformId: P,
  version: SupportedCeremonyVersion<P>,
  message: ProverIdentityProof,
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

// Version choice stays behind the same closed, validated catalog boundary.
export function greatestCommonVersion<P extends PlatformId>(
  platform: P,
  advertised: readonly number[],
): SupportedCeremonyVersion<P> {
  const versions = Object.keys(platforms[platform].versions)
    .map(Number)
    .filter((v) => advertised.includes(v))
  if (!versions.length) throw new TypeError('No supported platform version')
  return Math.max(...versions) as SupportedCeremonyVersion<P>
}

export function implementationFor<P extends PlatformId>(
  platform: P,
  version: SupportedCeremonyVersion<P>,
) {
  const implementation = platforms[platform].versions[version as 1]
  if (!implementation) throw new TypeError('Unsupported platform version')
  return implementation
}
