export const MAX_ATTESTED_DATA_BYTES = 2 * 1024 * 1024

export interface DecodedRevealedRange {
  start: number
  bytes: Uint8Array
}

export interface DecodedRangeCommitment {
  start: number
  end: number
  commitment: Uint8Array
}

export interface DecodedDirection {
  revealed: readonly DecodedRevealedRange[]
  commitments: readonly DecodedRangeCommitment[]
}

export interface DecodedAttestedData {
  authorityId: Uint8Array
  createdAt: string
  sentTranscriptLength: number
  receivedTranscriptLength: number
  sent: DecodedDirection
  received: DecodedDirection
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
    if (this.remaining < 4) invalid('truncated integer')
    const value = this.view.getUint32(this.offset)
    this.offset += 4
    return value
  }

  u64(): bigint {
    if (this.remaining < 8) invalid('truncated integer')
    const value = this.view.getBigUint64(this.offset)
    this.offset += 8
    return value
  }

  count(minimumItemBytes: number): number {
    const value = this.u64()
    if (value > BigInt(Math.floor(this.remaining / minimumItemBytes))) {
      invalid('collection count exceeds remaining input')
    }
    return Number(value)
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      invalid('truncated byte string')
    }
    const value = this.input.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }
}

function readDirection(cursor: Cursor, transcriptLength: number): DecodedDirection {
  const revealed: DecodedRevealedRange[] = []
  let previousEnd = 0
  for (let count = cursor.count(13); count > 0; count--) {
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
  for (let count = cursor.count(40); count > 0; count--) {
    const start = cursor.u32()
    const end = cursor.u32()
    if (start < previousEnd || end <= start || end > transcriptLength) {
      invalid('commitment ranges are empty, unordered, overlapping, or out of bounds')
    }
    commitments.push({ start, end, commitment: cursor.bytes(32) })
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

/** Decode the signed libid-rs bincode 2.0.1 fixed-int big-endian preimage. */
export function decodeAttestedData(bytes: Uint8Array): DecodedAttestedData {
  if (bytes.length > MAX_ATTESTED_DATA_BYTES) invalid('input exceeds size limit')
  const cursor = new Cursor(bytes)
  const authorityId = cursor.bytes(32)
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
