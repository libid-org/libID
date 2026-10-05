import type { ProveIdentity } from '../ccdp/index.js'
import type { OperationEvent } from '../events.js'
import type { PlatformId, platforms, SupportedCeremonyVersion } from './index.js'

/** A string exactly where platform `P`'s ceremony declares PKCE, otherwise null. */
type CodeVerifier<P extends PlatformId> = P extends PlatformId
  ? (typeof platforms)[P]['versions'][SupportedCeremonyVersion<P>]['pkce'] extends true
    ? string
    : null
  : never

/** Per-run inputs and one event producer shared by the Prover page and platform provers. */
export interface ProverContext<P extends PlatformId = PlatformId> {
  request: ProveIdentity
  /** The admitted OAuth return's credential: an authorization code or an ID token. */
  credential: string
  codeVerifier: CodeVerifier<P>
  signal: AbortSignal
  emit(event: OperationEvent): void
}
