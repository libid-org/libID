import type { AppStartProver, PlatformStep } from '../ccdp/index.js'
import type { OAuthReturn } from '../ccdp/navigation.js'
import type { ProverStage } from '../events.js'

/** Per-run inputs and advisory callbacks shared by the Prover page and platform pipelines. */
export interface ProverContext {
  request: AppStartProver
  ceremonyId: string
  oauthReturn: OAuthReturn
  signal: AbortSignal
  onStage(stage: ProverStage): void
  onProgress(step: PlatformStep, timestamp: number): void
}
