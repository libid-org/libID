import type { OperationEvent } from '../events.js'

/** Browser-generated bb output; structural checks here do not establish cryptographic validity. */
export interface RawProof {
  proof: Uint8Array
  publicInputs: string[]
  runtime: { effectiveThreads: number; sharedMemory: boolean }
}

export type FromWorker =
  | { type: 'booted'; timestamp: number }
  | { type: 'witness-ready' } // Noir can execute the witness; bb may still be initializing.
  | { type: 'event'; event: OperationEvent }
  | { type: 'backend-ready'; timestamp: number }
  | { type: 'result'; result: RawProof }
  | { type: 'error'; message: string; event: string }

export interface Preload {
  type: 'preload'
  circuitUrl: string
  verificationKeyUrl: string
  threads: number
  acvmUrl: string
  abiUrl: string
  wasmPath: string
  crsPath: string
}

export type ToWorker = Preload | { type: 'prove'; inputs: Record<string, unknown> }
