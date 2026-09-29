import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { concatBytes as concat } from '@noble/hashes/utils.js'
import type { HashOpening, NotarizationPlan } from '../notarize.js'
import type { ByteRange, Directions, Transcript } from '../protocol.js'

const encoder = new TextEncoder()

export { concat }

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value))
  return bytes
}

function encodeDirection(
  transcript: Uint8Array,
  revealed: readonly ByteRange[],
  commitments: readonly ByteRange[],
  hashes: readonly Uint8Array[],
): Uint8Array {
  return concat(
    u64(revealed.length),
    ...revealed.flatMap((range) => [
      u32(range.start),
      u64(range.end - range.start),
      transcript.slice(range.start, range.end),
    ]),
    u64(commitments.length),
    ...commitments.flatMap((range, index) => [u32(range.start), u32(range.end), hashes[index]]),
  )
}

export function encodeAttestation(
  transcript: Transcript,
  plan: NotarizationPlan,
  hashes: Directions<readonly Uint8Array[]>,
  commitments = plan.commit,
  authority = 'api.x.com',
): Uint8Array {
  return concat(
    keccak_256(encoder.encode(authority)),
    u64(1_770_000_000),
    u32(transcript.sent.length),
    u32(transcript.received.length),
    encodeDirection(transcript.sent, plan.reveal.sent, commitments.sent, hashes.sent),
    encodeDirection(
      transcript.received,
      plan.reveal.received,
      commitments.received,
      hashes.received,
    ),
  )
}

export function opening(transcript: Uint8Array, range: ByteRange, byte: number): HashOpening {
  const blinder = new Uint8Array(16).fill(byte)
  return {
    hash: sha256(concat(transcript.slice(range.start, range.end), blinder)),
    blinder,
  }
}
