import { hasExactKeys, isFixedBytes } from '../primitives.js'
import { MAX_ATTESTED_DATA_BYTES } from './limits.js'

/** Released notary format: secp256k1 signature, keccak authority, SHA256 commitment and blinder. */
export const NOTARY_SIGNATURE_BYTES = 65
export const AUTHORITY_ID_BYTES = 32
export const COMMITMENT_BYTES = 32
export const BLINDER_BYTES = 16

/** Original signed bytes; ledger verification remains authoritative. */
export interface NotaryAttestation {
  attestedData: Uint8Array
  signature: Uint8Array
}

/** Bound the delivered bytes; ledger verification remains authoritative. */
export function isNotaryAttestation(v: unknown): v is NotaryAttestation {
  return (
    hasExactKeys(v, ['attestedData', 'signature']) &&
    v.attestedData instanceof Uint8Array &&
    v.attestedData.length > 0 &&
    v.attestedData.length <= MAX_ATTESTED_DATA_BYTES &&
    isFixedBytes(v.signature, NOTARY_SIGNATURE_BYTES)
  )
}

/** One value per transcript direction. */
export type Directions<T> = { sent: T; received: T }

export interface ByteRange {
  start: number
  end: number
}

export interface ExactHttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Readonly<Record<string, Uint8Array>>
  body: Uint8Array
}

export type Transcript = Directions<Uint8Array>

export type Reveals = Directions<readonly ByteRange[]>

export interface CommitmentOpening extends ByteRange {
  direction: 'sent' | 'received'
  blinder: Uint8Array
}

export interface Prepare {
  type: 'prepare'
  url: string
  moduleUrl: string
  wasmUrl: string
  notaryAddress: string
  port: MessagePort
}

export type ToWorker =
  | { type: 'send'; request: ExactHttpRequest }
  | { type: 'reveal'; reveals: Reveals }

export type FromWorker =
  /** The SDK runtime has loaded; setup, which the preparation deadline bounds, starts now. */
  | { type: 'initialized' }
  | { type: 'prepared' }
  | { type: 'sent'; transcript: Transcript }
  | { type: 'revealed'; openings: CommitmentOpening[] }
  | { type: 'attestation'; attestation: NotaryAttestation; attributes: Record<string, number> }
  | { type: 'error'; message: string }
