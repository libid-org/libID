import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { concatBytes } from '@noble/hashes/utils.js'
import { bytesEqual, isFixedBytes } from '../primitives.js'
import { type DecodedAttestedData, type DecodedDirection, decodeAttestedData } from './decode.js'
import { MAX_RECV_BYTES, MAX_SENT_BYTES } from './limits.js'
import {
  BLINDER_BYTES,
  type ByteRange,
  COMMITMENT_BYTES,
  type CommitmentOpening,
  type Directions,
  type Reveals,
  type Transcript,
} from './protocol.js'

export interface CommitRange extends ByteRange {
  algorithm: 'SHA256'
}

export interface NotarizationPlan {
  reveal: Directions<ByteRange[]>
  commit: Directions<CommitRange[]>
}

export interface HashOpening {
  hash: Uint8Array
  blinder: Uint8Array
}

export interface CorrelatedCommitment extends ByteRange, HashOpening {}

export type Correlated = Directions<readonly CorrelatedCommitment[]>

function invalid(reason: string): never {
  throw new Error(`invalid notarization: ${reason}`)
}

function validateRanges(ranges: readonly ByteRange[], length: number, direction: string): void {
  let previousEnd = 0
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < previousEnd ||
      range.end <= range.start ||
      range.end > length
    ) {
      invalid(`${direction} reveal ranges must be sorted, nonempty, nonoverlapping, and in bounds`)
    }
    previousEnd = range.end
  }
}

function complement(ranges: readonly ByteRange[], length: number): CommitRange[] {
  const hidden: CommitRange[] = []
  let start = 0
  for (const range of ranges) {
    if (start < range.start) hidden.push({ start, end: range.start, algorithm: 'SHA256' })
    start = range.end
  }
  if (start < length) hidden.push({ start, end: length, algorithm: 'SHA256' })
  return hidden
}

// TLSNotary stores disclosed bytes as a range set, merging adjacent intervals.
function mergeAdjacent(ranges: readonly ByteRange[]): ByteRange[] {
  const merged: ByteRange[] = []
  for (const { start, end } of ranges) {
    const previous = merged.at(-1)
    if (previous?.end === start) previous.end = end
    else merged.push({ start, end })
  }
  return merged
}

/** Build the reveal ranges and their exact commitment complement. */
export function planNotarization(transcript: Transcript, ranges: Reveals): NotarizationPlan {
  if (transcript.sent.length > MAX_SENT_BYTES) invalid('sent transcript exceeds 4 KiB')
  if (transcript.received.length > MAX_RECV_BYTES) invalid('received transcript exceeds 32 KiB')
  validateRanges(ranges.sent, transcript.sent.length, 'sent')
  validateRanges(ranges.received, transcript.received.length, 'received')

  const sent = mergeAdjacent(ranges.sent)
  const received = mergeAdjacent(ranges.received)
  return {
    reveal: { sent, received },
    commit: {
      sent: complement(sent, transcript.sent.length),
      received: complement(received, transcript.received.length),
    },
  }
}

function sameRange(a: ByteRange, b: ByteRange): boolean {
  return a.start === b.start && a.end === b.end
}

function requireRevealed(
  transcript: Uint8Array,
  ranges: readonly ByteRange[],
  signed: DecodedDirection,
  direction: string,
): void {
  if (signed.revealed.length !== ranges.length) invalid(`${direction} revealed range count changed`)
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]
    const revealed = signed.revealed[index]
    if (
      revealed.start !== range.start ||
      revealed.bytes.length !== range.end - range.start ||
      !bytesEqual(revealed.bytes, transcript.subarray(range.start, range.end))
    ) {
      invalid(`${direction} revealed range changed`)
    }
  }
}

function requireCommitted(
  correlated: readonly CorrelatedCommitment[],
  signed: DecodedDirection,
  direction: string,
): void {
  if (signed.commitments.length !== correlated.length) {
    invalid(`${direction} signed commitment count changed`)
  }
  for (let index = 0; index < correlated.length; index++) {
    if (!sameRange(correlated[index], signed.commitments[index])) {
      invalid(`${direction} signed commitment range changed`)
    }
    if (!bytesEqual(signed.commitments[index].hash, correlated[index].hash)) {
      invalid(`${direction} signed commitment hash changed`)
    }
  }
}

/** SHA256(hidden bytes || 16-byte blinder), the TLSNotary plaintext-hash commitment. */
function commitmentHash(bytes: Uint8Array, blinder: Uint8Array): Uint8Array {
  return sha256(concatBytes(bytes, blinder))
}

/** Match unordered provisional openings without treating them as signed evidence. */
function correlateOpenings(
  transcript: Uint8Array,
  planned: readonly CommitRange[],
  openings: readonly HashOpening[],
  direction: string,
): CorrelatedCommitment[] {
  if (openings.length !== planned.length) invalid(`${direction} opening count changed`)

  // ponytail: quadratic scan over the small, fixed per-platform range sets.
  const unmatched = new Set(planned.keys())
  const correlated: CorrelatedCommitment[] = []
  for (const opening of openings) {
    if (!isFixedBytes(opening.hash, COMMITMENT_BYTES))
      invalid(`${direction} opening hash must be exactly 32 bytes`)
    if (!isFixedBytes(opening.blinder, BLINDER_BYTES))
      invalid(`${direction} opening blinder must be exactly 16 bytes`)

    const matches = [...unmatched].filter((index) =>
      bytesEqual(
        commitmentHash(
          transcript.subarray(planned[index].start, planned[index].end),
          opening.blinder,
        ),
        opening.hash,
      ),
    )
    if (matches.length !== 1) invalid(`${direction} opening does not identify one hidden range`)
    const index = matches[0]
    unmatched.delete(index)
    correlated[index] = {
      start: planned[index].start,
      end: planned[index].end,
      hash: opening.hash.slice(),
      blinder: opening.blinder.slice(),
    }
  }
  return correlated
}

/** Correlate both directions of one TLSNotary reveal, in planned commitment order. */
export function correlateReveal(
  transcript: Transcript,
  plan: NotarizationPlan,
  openings: Directions<readonly HashOpening[]>,
): Correlated {
  const correlate = (direction: 'sent' | 'received') =>
    correlateOpenings(transcript[direction], plan.commit[direction], openings[direction], direction)
  return { sent: correlate('sent'), received: correlate('received') }
}

/** Require the signed record to match the transcript, planned reveals and correlated openings. */
export function matchAttestedData(
  authority: string,
  transcript: Transcript,
  plan: NotarizationPlan,
  correlated: Correlated,
  attestedData: Uint8Array,
): DecodedAttestedData {
  const decoded = decodeAttestedData(attestedData)
  if (!bytesEqual(decoded.authorityId, keccak_256(new TextEncoder().encode(authority))))
    invalid('attested authority changed')
  if (
    decoded.sentTranscriptLength !== transcript.sent.length ||
    decoded.receivedTranscriptLength !== transcript.received.length
  ) {
    invalid('signed transcript length changed')
  }
  requireRevealed(transcript.sent, plan.reveal.sent, decoded.sent, 'sent')
  requireRevealed(transcript.received, plan.reveal.received, decoded.received, 'received')
  requireCommitted(correlated.sent, decoded.sent, 'sent')
  requireCommitted(correlated.received, decoded.received, 'received')
  return decoded
}

/** Select the one provisional opening of `range` and rebuild its commitment from known plaintext. */
export function plaintextOpening(
  openings: readonly CommitmentOpening[],
  direction: 'sent' | 'received',
  range: ByteRange,
  plaintext: Uint8Array,
) {
  const matches = openings.filter((o) => o.direction === direction && sameRange(o, range))
  if (matches.length !== 1) throw new Error('Plaintext opening is not unique')
  const opening = matches[0]
  if (opening.blinder.length !== BLINDER_BYTES || opening.end - opening.start !== plaintext.length)
    throw new Error('Invalid plaintext opening')
  return { ...opening, hash: commitmentHash(plaintext, opening.blinder) }
}
