import type { NotaryAttestation } from './decode.js'

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
  | { type: 'prepared' }
  | { type: 'sent'; transcript: Transcript }
  | { type: 'revealed'; openings: CommitmentOpening[] }
  | { type: 'attestation'; attestation: NotaryAttestation; attributes: Record<string, number> }
  | { type: 'error'; message: string }
