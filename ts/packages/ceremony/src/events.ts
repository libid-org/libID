import type { PlatformStep } from './ccdp/index.js'
import type { FailureCode } from './errors.js'

export const stages = [
  'start',
  'prefetch',
  'authorization',
  'oauth-return',
  'code-exchange',
  'identity-fetch',
  'proof-preparation',
  'proof-generation',
  'finalizing',
] as const
export type CeremonyStage = (typeof stages)[number]
const stageMessages = {
  start: ['Opening popup', 'Popup opened'],
  prefetch: ['Prefetching assets', 'Prefetch dispatched'],
  authorization: ['Authorizing', 'User authorised'],
  'oauth-return': ['Returning from authorization', 'OAuth return received'],
  'code-exchange': ['Notarizing token', 'Token ready'],
  'identity-fetch': ['Notarizing identity', 'Identity ready'],
  'proof-preparation': ['Setting up prover', 'Prover ready'],
  'proof-generation': ['Generating proof', 'Proof generated'],
  finalizing: ['Completing', 'Complete'],
} satisfies Record<CeremonyStage, readonly [string, string]>

/** Package-owned display groups and wording; complete a group only when it ends. */
export const CeremonyStage = {
  group(stage: CeremonyStage): CeremonyStage {
    return stage === 'prefetch' || stage === 'oauth-return' ? 'authorization' : stage
  },
  inProgress(stage: CeremonyStage): string {
    return stageMessages[stage][0]
  },
  completed(stage: CeremonyStage): string {
    return stageMessages[stage][1]
  },
} as const

export type ProverStage = Exclude<
  CeremonyStage,
  'start' | 'prefetch' | 'authorization' | 'oauth-return'
>
export type CeremonyEvent =
  | { type: 'stage'; stage: CeremonyStage; timestamp: number }
  | { type: 'step'; platformStep: PlatformStep; timestamp: number }
  | { type: 'finished'; outcome: 'success' | 'denied' | 'cancelled'; timestamp: number }
  | { type: 'finished'; outcome: 'failed'; code: FailureCode | null; timestamp: number }
