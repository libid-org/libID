import { readFileSync } from 'node:fs'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { describe, expect, it } from 'vitest'
import { decodeAttestedData, MAX_ATTESTED_DATA_BYTES } from './decode.js'

// libid-org/libid-rs@239a4bb426ac72591fe30006f22660e164a98d96,
// crates/libid-ceremony/src/attestation.rs::CROSS_LANGUAGE_FIXTURE.
const FIXTURE = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL('../../test-fixtures/libid-rs-239a4bb-attested-data.hex', import.meta.url),
      'utf8',
    ).trim(),
    'hex',
  ),
)

const changed = (offset: number, value: number): Uint8Array => {
  const bytes = FIXTURE.slice()
  bytes[offset] = value
  return bytes
}

const withU32 = (offset: number, value: number): Uint8Array => {
  const bytes = FIXTURE.slice()
  new DataView(bytes.buffer).setUint32(offset, value)
  return bytes
}

const withU64 = (offset: number, value: bigint): Uint8Array => {
  const bytes = FIXTURE.slice()
  new DataView(bytes.buffer).setBigUint64(offset, value)
  return bytes
}

describe('decodeAttestedData', () => {
  it('[LIBID-PROVER-010] matches the pinned libid-rs fixture completely', () => {
    expect(Buffer.from(keccak_256(FIXTURE)).toString('hex')).toBe(
      '48162f05bdb27b19b3544bf2aae608745861bf357bb31e07f536b6fb50e95936',
    )
    expect(decodeAttestedData(FIXTURE)).toEqual({
      authorityId: Uint8Array.from(
        Buffer.from('4930142f5283d4a8eab0d24c588f00b21213ae2a47e7ed6c1dc6a57044f1655d', 'hex'),
      ),
      createdAt: '1770000000',
      sentTranscriptLength: 60,
      receivedTranscriptLength: 40,
      sent: {
        revealed: [
          { start: 0, bytes: new Uint8Array(20).fill('a'.charCodeAt(0)) },
          { start: 40, bytes: new Uint8Array(20).fill('b'.charCodeAt(0)) },
        ],
        commitments: [{ start: 20, end: 40, commitment: new Uint8Array(32).fill(7) }],
      },
      received: {
        revealed: [{ start: 0, bytes: new Uint8Array(10).fill('c'.charCodeAt(0)) }],
        commitments: [{ start: 10, end: 40, commitment: new Uint8Array(32).fill(9) }],
      },
    })
  })

  it('decodes one-byte changes to valid fields instead of normalizing them', () => {
    expect(decodeAttestedData(changed(0, FIXTURE[0] ^ 1)).authorityId[0]).toBe(FIXTURE[0] ^ 1)
    expect(decodeAttestedData(changed(39, FIXTURE[39] + 1)).createdAt).toBe('1770000001')
    expect(decodeAttestedData(withU32(40, 61)).sentTranscriptLength).toBe(61)
    expect(decodeAttestedData(withU32(44, 41)).receivedTranscriptLength).toBe(41)
    expect(decodeAttestedData(changed(68, 'd'.charCodeAt(0))).sent.revealed[0].bytes[0]).toBe(
      'd'.charCodeAt(0),
    )
    expect(decodeAttestedData(changed(136, 8)).sent.commitments[0].commitment[0]).toBe(8)
  })

  it.each<[string, Uint8Array, RegExp]>([
    ['oversize input', new Uint8Array(MAX_ATTESTED_DATA_BYTES + 1), /size limit/],
    ['truncation', FIXTURE.slice(0, -1), /collection count/],
    ['trailing bytes', Uint8Array.from([...FIXTURE, 0]), /trailing bytes/],
    ['collection-count overflow', withU64(48, 0xffff_ffff_ffff_ffffn), /collection count/],
    ['byte-length overflow', withU64(60, 0xffff_ffff_ffff_ffffn), /range length/],
    ['empty revealed range', withU64(60, 0n), /empty revealed range/],
    ['unordered revealed ranges', withU32(88, 10), /revealed ranges/],
    ['revealed/commitment overlap', withU32(128, 19), /revealed and committed/],
    ['empty commitment', withU32(132, 20), /commitment ranges/],
    ['out-of-bounds commitment', withU32(132, 61), /commitment ranges/],
    [
      'varint collection count',
      Uint8Array.from([...FIXTURE.slice(0, 48), 2, ...FIXTURE.slice(56)]),
      /collection count/,
    ],
  ])('rejects %s', (_name, bytes, reason) => {
    expect(() => decodeAttestedData(bytes)).toThrow(reason)
  })
})
