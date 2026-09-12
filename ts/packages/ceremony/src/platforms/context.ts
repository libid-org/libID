import type { ProveIdentity } from '../ccdp/index.js'
import type { OAuthReturn } from '../ccdp/navigation.js'
import type { OperationEvent } from '../events.js'

/** Per-run inputs and one event producer shared by the Prover page and platform pipelines. */
export interface ProverContext {
  request: ProveIdentity
  ceremonyId: string
  oauthReturn: OAuthReturn
  signal: AbortSignal
  emit(event: OperationEvent): void
}
