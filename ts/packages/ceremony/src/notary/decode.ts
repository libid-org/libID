import { MAX_ATTESTED_DATA_BYTES } from './limits.js'
import {
  AUTHORITY_ID_BYTES,
  type ByteRange,
  COMMITMENT_BYTES,
  type Directions,
} from './protocol.js'

// Fixed-int bincode: u32 start, u64 byte length, at least one disclosed byte.
const MIN_REVEALED_RANGE_BYTES = 4 + 8 + 1
// Two u32 offsets followed by the commitment digest.
const COMMITTED_RANGE_BYTES = 4 + 4 + COMMITMENT_BYTES

export interface DecodedRevealedRange {
  start: number
  bytes: Uint8Array
}

export interface DecodedRangeCommitment extends ByteRange {
  hash: Uint8Array
}

export interface DecodedDirection {
  revealed: readonly DecodedRevealedRange[]
  commitments: readonly DecodedRangeCommitment[]
}

export interface DecodedAttestedData extends Directions<DecodedDirection> {
  authorityId: Uint8Array
  /** Signed Unix seconds as canonical decimal text, preserving the complete u64 range. */
  createdAt: string
  sentTranscriptLength: number
  receivedTranscriptLength: number
}

function invalid(reason: string): never {
  throw new Error(`invalid attested data: ${reason}`)
}

class Cursor {
  private offset = 0
  private readonly view: DataView

  constructor(private readonly input: Uint8Array) {
    this.view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  }

  get remaining(): number {
    return this.input.length - this.offset
  }

  u32(): number {
    return this.view.getUint32(this.take(4, 'truncated integer'))
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8, 'truncated integer'))
  }

  count(minimumItemBytes: number): number {
    const value = this.u64()
    if (value > BigInt(Math.floor(this.remaining / minimumItemBytes))) {
      invalid('collection count exceeds remaining input')
    }
    return Number(value)
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) invalid('truncated byte string')
    const start = this.take(length, 'truncated byte string')
    return this.input.slice(start, start + length)
  }

  /** Consume `length` bytes, returning their start offset. */
  private take(length: number, reason: string): number {
    if (length > this.remaining) invalid(reason)
    this.offset += length
    return this.offset - length
  }
}

function readDirection(cursor: Cursor, transcriptLength: number): DecodedDirection {
  const revealed: DecodedRevealedRange[] = []
  let previousEnd = 0
  for (let count = cursor.count(MIN_REVEALED_RANGE_BYTES); count > 0; count--) {
    const start = cursor.u32()
    const length = cursor.u64()
    if (length === 0n) invalid('empty revealed range')
    if (length > BigInt(cursor.remaining) || length > BigInt(transcriptLength)) {
      invalid('revealed range length is out of bounds')
    }
    const byteLength = Number(length)
    if (start < previousEnd || start > transcriptLength - byteLength) {
      invalid('revealed ranges are unordered, overlapping, or out of bounds')
    }
    revealed.push({ start, bytes: cursor.bytes(byteLength) })
    previousEnd = start + byteLength
  }

  const commitments: DecodedRangeCommitment[] = []
  previousEnd = 0
  for (let count = cursor.count(COMMITTED_RANGE_BYTES); count > 0; count--) {
    const start = cursor.u32()
    const end = cursor.u32()
    if (start < previousEnd || end <= start || end > transcriptLength) {
      invalid('commitment ranges are empty, unordered, overlapping, or out of bounds')
    }
    commitments.push({ start, end, hash: cursor.bytes(COMMITMENT_BYTES) })
    previousEnd = end
  }

  let revealedIndex = 0
  let commitmentIndex = 0
  while (revealedIndex < revealed.length && commitmentIndex < commitments.length) {
    const reveal = revealed[revealedIndex]
    const commitment = commitments[commitmentIndex]
    const revealEnd = reveal.start + reveal.bytes.length
    if (revealEnd <= commitment.start) revealedIndex++
    else if (commitment.end <= reveal.start) commitmentIndex++
    else invalid('revealed and committed ranges overlap')
  }

  return { revealed, commitments }
}

/**
 * Decode the signed libid-rs bincode 2.0.1 fixed-int big-endian preimage, without re-encoding.
 * Collection/byte-string lengths are u64; transcript lengths and offsets are u32.
 * Bounds are checked before allocation or conversion to number; the cross-language
 * fixture and its digest are pinned in decode.test.ts.
 */
export function decodeAttestedData(bytes: Uint8Array): DecodedAttestedData {
  if (bytes.length > MAX_ATTESTED_DATA_BYTES) invalid('input exceeds size limit')
  const cursor = new Cursor(bytes)
  const authorityId = cursor.bytes(AUTHORITY_ID_BYTES)
  const createdAt = cursor.u64().toString()
  const sentTranscriptLength = cursor.u32()
  const receivedTranscriptLength = cursor.u32()
  const sent = readDirection(cursor, sentTranscriptLength)
  const received = readDirection(cursor, receivedTranscriptLength)
  if (cursor.remaining !== 0) invalid('trailing bytes')
  return {
    authorityId,
    createdAt,
    sentTranscriptLength,
    receivedTranscriptLength,
    sent,
    received,
  }
}
