import type { ProverContext } from './context.js'
import type { PlatformId, ProofByPlatformVersion, SupportedCeremonyVersion } from './index.js'
import type { Identity } from './types.js'

/** Platform `P`'s delivered identity beside a proof of one of its versions. */
export type ProverResult<P extends PlatformId = PlatformId> = P extends PlatformId
  ? { identity: Identity<P>; proof: ProofByPlatformVersion[P][SupportedCeremonyVersion<P>] }
  : never

/**
 * Platform `P`'s `prover.ts` module, which the Prover document loads once a request selects it.
 * Typed per platform, so a table entry or fixture importing another platform's fails typecheck.
 */
export type ProverModule<P extends PlatformId = PlatformId> = {
  prove(context: ProverContext): Promise<ProverResult<P> | null>
}

/**
 * Each platform's provers by ceremony version: where a platform registers a version's prover.
 * Only the Prover document imports this table. The catalog, which the Client bundles, stays free
 * of these loaders, so an application never bundles a prover.
 */
export const provers = {
  google: { 1: () => import('./google/1/prover.js') },
  x: { 1: () => import('./x/1/prover.js') },
  github: { 1: () => import('./github/1/prover.js') },
} as const satisfies {
  [P in PlatformId]: { [V in SupportedCeremonyVersion<P>]: () => Promise<ProverModule<P>> }
}

/** The prover registered for a platform and version: the pair it serves and its module's loader. */
export type Prover = {
  platformId: PlatformId
  version: SupportedCeremonyVersion<PlatformId>
  load(): Promise<ProverModule>
}

/** The prover a proving request names, or `undefined` when the Prover bundles none for it. */
export function proverFor(platformId: string, version: number): Prover | undefined {
  if (!Object.hasOwn(provers, platformId)) return undefined
  const versions: Partial<Record<number, () => Promise<ProverModule>>> =
    provers[platformId as PlatformId]
  const load = Object.hasOwn(versions, version) ? versions[version] : undefined
  return (
    load && {
      platformId: platformId as PlatformId,
      version: version as SupportedCeremonyVersion<PlatformId>,
      load,
    }
  )
}
