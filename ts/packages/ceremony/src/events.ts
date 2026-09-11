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
] as const

export type CeremonyStage = (typeof stages)[number]

const stageMessages = {
  start: ['Opening popup', 'Popup opened'],
  prefetch: ['Prefetching assets', 'Prefetch dispatched'],
  authorization: ['Authorizing', 'User authorised'],
  'oauth-return': ['Returning from authorization', 'OAuth return received'],
  'code-exchange': ['Fetching token via notary', 'Token fetched via notary'],
  'identity-fetch': ['Fetching identity via notary', 'Identity fetched via notary'],
  'proof-preparation': ['Setting up ZK prover', 'ZK prover ready'],
  'proof-generation': ['Generating proof', 'Proof generated'],
} satisfies Record<CeremonyStage, readonly [string, string]>

/** Package-owned display groups and wording; complete a group only when it ends. */
export const CeremonyStage = {
  group(stage: CeremonyStage): CeremonyStage {
    return stage === 'prefetch' || stage === 'oauth-return' ? 'authorization' : stage
  },
  inProgress(stage: CeremonyStage): string {
    return stageMessages[stage][0]
  },
  /** Label a completed interval; receiving the stage-start event alone does not complete it. */
  completed(stage: CeremonyStage): string {
    return stageMessages[stage][1]
  },
} as const

export type ProverStage = Exclude<
  CeremonyStage,
  'start' | 'prefetch' | 'authorization' | 'oauth-return'
>

/** Advisory UI events. `finished` fires once before result settlement and carries no proof material. */
export type CeremonyEvent =
  | { type: 'stage'; stage: CeremonyStage; timestamp: number }
  | { type: 'step'; platformStep: PlatformStep; timestamp: number }
  | { type: 'finished'; outcome: 'success' | 'denied' | 'cancelled'; timestamp: number }
  | { type: 'finished'; outcome: 'failed'; code: FailureCode | null; timestamp: number }
