import type { PlatformStep } from './ccdp/index.js'
import type { FailureCode } from './errors.js'

export const stages = [
  'authorization',
  'code-exchange',
  'identity-fetch',
  'proof-preparation',
  'proof-generation',
  'finalizing',
] as const
export type CeremonyStage = (typeof stages)[number]
export type ProverStage = Exclude<CeremonyStage, 'authorization'>
export type CeremonyEvent =
  | { type: 'stage'; stage: CeremonyStage; timestamp: number }
  | { type: 'step'; platformStep: PlatformStep; timestamp: number }
  | { type: 'finished'; outcome: 'success' | 'denied' | 'cancelled'; timestamp: number }
  | { type: 'finished'; outcome: 'failed'; code: FailureCode | null; timestamp: number }
