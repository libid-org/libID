import type { AppStartProver, PlatformStep } from '../ccdp/index.js'
import type { OAuthReturn } from '../ccdp/navigation.js'
export interface ProverContext {
  request: AppStartProver
  ceremonyId: string
  oauthReturn: OAuthReturn
  signal: AbortSignal
  onProgress(step: PlatformStep, timestamp: number): void
}
