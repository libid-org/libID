import { sha256 } from '@noble/hashes/sha2.js'
import { bytesEqual } from '../../primitives.js'
import { decodeAttestedData, type DecodedAttestedData, type DecodedDirection } from './decode.js'

const MAX_SENT_BYTES = 4 * 1024
const MAX_RECV_BYTES = 32 * 1024

export interface ByteRange {
  start: number
  end: number
}

export interface Transcript {
  sent: Uint8Array
  recv: Uint8Array
}

export interface RevealRanges {
  sent: readonly ByteRange[]
  recv: readonly ByteRange[]
}

export interface CommitRange extends ByteRange {
  algorithm: 'SHA256'
}

export interface NotarizationPlan {
  reveal: {
    sent: ByteRange[]
    recv: ByteRange[]
    server_identity: true
  }
  commit: {
    sent: CommitRange[]
    recv: CommitRange[]
  }
}

export interface HashOpening {
  hash: Uint8Array
  blinder: Uint8Array
}

export interface RevealOutput {
  sent: readonly HashOpening[]
  recv: readonly HashOpening[]
}

export interface CorrelatedCommitment extends ByteRange, HashOpening {}

export interface CorrelatedAttestation {
  decoded: DecodedAttestedData
  sent: readonly CorrelatedCommitment[]
  recv: readonly CorrelatedCommitment[]
}

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

/** Build the exact range objects accepted by TLSNotary's browser `reveal`. */
export function planNotarization(transcript: Transcript, ranges: RevealRanges): NotarizationPlan {
  if (transcript.sent.length > MAX_SENT_BYTES) invalid('sent transcript exceeds 4 KiB')
  if (transcript.recv.length > MAX_RECV_BYTES) invalid('received transcript exceeds 32 KiB')
  validateRanges(ranges.sent, transcript.sent.length, 'sent')
  validateRanges(ranges.recv, transcript.recv.length, 'received')

  const sent = mergeAdjacent(ranges.sent)
  const recv = mergeAdjacent(ranges.recv)
  return {
    reveal: { sent, recv, server_identity: true },
    commit: {
      sent: complement(sent, transcript.sent.length),
      recv: complement(recv, transcript.recv.length),
    },
  }
}

function sameRange(a: ByteRange, b: ByteRange): boolean {
  return a.start === b.start && a.end === b.end
}

function requireExactPlan(transcript: Transcript, plan: NotarizationPlan): void {
  if (plan.reveal.server_identity !== true) invalid('server identity must be revealed')
  const expected = planNotarization(transcript, plan.reveal)
  for (const direction of ['sent', 'recv'] as const) {
    const actual = plan.commit[direction]
    const wanted = expected.commit[direction]
    if (
      actual.length !== wanted.length ||
      actual.some(
        (range, index) => range.algorithm !== 'SHA256' || !sameRange(range, wanted[index]),
      )
    ) {
      invalid(`${direction} commitment plan is not the reveal complement`)
    }
  }
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

function commitmentHash(transcript: Uint8Array, range: ByteRange, blinder: Uint8Array): Uint8Array {
  const input = new Uint8Array(range.end - range.start + blinder.length)
  input.set(transcript.subarray(range.start, range.end))
  input.set(blinder, range.end - range.start)
  return sha256(input)
}

function correlateDirection(
  transcript: Uint8Array,
  planned: readonly CommitRange[],
  openings: readonly HashOpening[],
  signed: DecodedDirection,
  direction: string,
): CorrelatedCommitment[] {
  if (signed.commitments.length !== planned.length) {
    invalid(`${direction} signed commitment count changed`)
  }
  for (let index = 0; index < planned.length; index++) {
    if (!sameRange(planned[index], signed.commitments[index])) {
      invalid(`${direction} signed commitment range changed`)
    }
  }
  const correlated = correlateOpenings(transcript, planned, openings, direction)
  for (let index = 0; index < correlated.length; index++) {
    if (!bytesEqual(signed.commitments[index].commitment, correlated[index].hash)) {
      invalid(`${direction} signed commitment hash changed`)
    }
  }
  return correlated
}

/** Match unordered provisional openings without treating them as signed evidence. */
export function correlateOpenings(
  transcript: Uint8Array,
  planned: readonly CommitRange[],
  openings: readonly HashOpening[],
  direction: string,
): CorrelatedCommitment[] {
  if (openings.length !== planned.length) invalid(`${direction} opening count changed`)

  // ponytail: quadratic scan over the small, fixed profile range sets.
  const unmatched = new Set(planned.keys())
  const correlated: CorrelatedCommitment[] = []
  for (const opening of openings) {
    if (!(opening.hash instanceof Uint8Array) || opening.hash.length !== 32) {
      invalid(`${direction} opening hash must be exactly 32 bytes`)
    }
    if (!(opening.blinder instanceof Uint8Array) || opening.blinder.length !== 16) {
      invalid(`${direction} opening blinder must be exactly 16 bytes`)
    }

    const matches = [...unmatched].filter((index) =>
      bytesEqual(commitmentHash(transcript, planned[index], opening.blinder), opening.hash),
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

/** Validate TLSNotary openings against both the transcript and signed record. */
export function correlateAttestation(
  transcript: Transcript,
  plan: NotarizationPlan,
  openings: RevealOutput,
  attestedData: Uint8Array,
): CorrelatedAttestation {
  requireExactPlan(transcript, plan)
  const decoded = decodeAttestedData(attestedData)
  if (
    decoded.sentTranscriptLength !== transcript.sent.length ||
    decoded.receivedTranscriptLength !== transcript.recv.length
  ) {
    invalid('signed transcript length changed')
  }
  requireRevealed(transcript.sent, plan.reveal.sent, decoded.sent, 'sent')
  requireRevealed(transcript.recv, plan.reveal.recv, decoded.received, 'received')
  return {
    decoded,
    sent: correlateDirection(
      transcript.sent,
      plan.commit.sent,
      openings.sent,
      decoded.sent,
      'sent',
    ),
    recv: correlateDirection(
      transcript.recv,
      plan.commit.recv,
      openings.recv,
      decoded.received,
      'received',
    ),
  }
}
