import type { OperationEvent } from '../events.js'
import { FIELD_HEX_DIGITS } from './parameters.js'

/** Canonical public field spelling used by both circuit adapters. */
export const fieldHex = (value: bigint | number): string =>
  `0x${BigInt(value).toString(16).padStart(FIELD_HEX_DIGITS, '0')}`

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
