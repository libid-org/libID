import type { IdentityProof } from '../ccdp/index.js'
import * as bearerEvents from './bearer-link/events.js'
import {
  isClientId as githubClientId,
  validateIdentity as githubIdentity,
  validateProof as githubProof,
} from './github/1/types.js'
import * as githubUrl from './github/1/url.js'
import * as googleEvents from './google/1/events.js'
import {
  isClientId as googleClientId,
  validateIdentity as googleIdentity,
  validateProof as googleProof,
} from './google/1/types.js'
import * as googleUrl from './google/1/url.js'
import type { Identity } from './types.js'
import {
  isClientId as xClientId,
  validateIdentity as xIdentity,
  validateProof as xProof,
} from './x/1/types.js'
import * as xUrl from './x/1/url.js'

export type { Identity } from './types.js'

export const platforms = {
  google: {
    requiresClientCredential: false,
    isClientId: googleClientId,
    versions: {
      1: {
        ...googleUrl,
        ...googleEvents,
        validateIdentity: googleIdentity,
        validateProof: googleProof,
      },
    },
  },
  x: {
    requiresClientCredential: false,
    isClientId: xClientId,
    versions: {
      1: { ...xUrl, ...bearerEvents, validateIdentity: xIdentity, validateProof: xProof },
    },
  },
  github: {
    requiresClientCredential: true,
    isClientId: githubClientId,
    versions: {
      1: {
        ...githubUrl,
        ...bearerEvents,
        validateIdentity: githubIdentity,
        validateProof: githubProof,
      },
    },
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

export function assembleResult<P extends PlatformId>(
  platformId: P,
  version: SupportedCeremonyVersion<P>,
  message: IdentityProof,
  clientId: string,
  authorizationNonce: Uint8Array,
): IdentityResult<P> {
  const implementation = implementationFor(platformId, version)
  const identity = implementation.validateIdentity(message.identity)
  const proof = implementation.validateProof(message.proof)
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
  if (!isPlatformId(platform)) throw new TypeError('Unsupported platform')
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
