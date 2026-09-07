import type { LedgerId } from '@libid/ledger'
import type { AppStartProver, PlatformStep } from '../ccdp/index.js'
import type { OAuthReturn } from '../ccdp/navigation.js'
export interface ProverContext {
  request: AppStartProver
  ledgerId: LedgerId
  notaryAddress: string
  ceremonyId: string
  oauthReturn: OAuthReturn
  signal: AbortSignal
  onProgress(step: PlatformStep, timestamp: number): void
}
