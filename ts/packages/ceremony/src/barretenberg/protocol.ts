import type { OperationEvent } from '../events.js'
import type { RawProof } from './engine.js'

export type FromWorker =
  | { type: 'engine-booted'; timestamp: number }
  | { type: 'engine-ready' } // Ready for witness execution; bb may still be initializing.
  | { type: 'engine-event'; event: OperationEvent }
  | { type: 'engine-prepared'; timestamp: number }
  | { type: 'engine-result'; result: RawProof }
  | { type: 'engine-error'; error: string; event: string }

export interface Preload {
  type: 'engine-preload'
  circuitUrl: string
  verificationKeyUrl: string
  threads: number
  acvmUrl: string
  abiUrl: string
  wasmPath: string
  crsPath: string
}

export type ToWorker = Preload | { type: 'engine-prove'; inputs: Record<string, unknown> }
