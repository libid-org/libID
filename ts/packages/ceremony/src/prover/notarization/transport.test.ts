import { describe, expect, it } from 'vitest'
import { decodeAttestationFrame, deriveNotaryWebSocketUrl } from './transport.js'

// Exact `write_msg` output for the smoke vector in libid-org/notary PR #6 at
// d449da1e380a70c04d291d34bf0fe2bcf876d9ba (176-byte compact serde JSON).
const CANONICAL_FRAME = Uint8Array.from(
  Buffer.from(
    '000000b07b2261747465737465645f64617461223a5b312c322c335d2c226e6f746172795f7369676e6174757265223a5b342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c342c345d7d',
    'hex',
  ),
)

function framePayload(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + 4)
  new DataView(frame.buffer).setUint32(0, payload.length)
  frame.set(payload, 4)
  return frame
}

function frameJson(value: unknown): Uint8Array {
  return framePayload(new TextEncoder().encode(JSON.stringify(value)))
}

const validPayload = (signature: unknown = new Array(65).fill(4)) => ({
  attested_data: [1, 2, 3],
  notary_signature: signature,
})

describe('deriveNotaryWebSocketUrl', () => {
  it.each([
    ['https://notary.testnet.lib.id', 'wss://notary.testnet.lib.id/notarize-proxy'],
    ['https://notary.example:7048', 'wss://notary.example:7048/notarize-proxy'],
  ])('derives the fixed proxy route from %s', (address, expected) => {
    expect(deriveNotaryWebSocketUrl(address)).toBe(expected)
  })

  it.each([
    'http://notary.example',
    'ws://notary.example',
    'wss://notary.example',
    'ftp://notary.example',
    'https://user@notary.example',
    'https://notary.example/',
    'https://notary.example/notarize-proxy',
    'https://notary.example/other',
    'https://notary.example?',
    'https://notary.example?sessionId=1',
    'https://notary.example#',
    'https://notary.example#fragment',
    'notary.example',
  ])('rejects %s', (address) => {
    expect(() => deriveNotaryWebSocketUrl(address)).toThrow(/canonical HTTPS origin/)
  })
})

describe('decodeAttestationFrame', () => {
  it('decodes the canonical upstream frame and nothing else', () => {
    expect(decodeAttestationFrame(CANONICAL_FRAME)).toEqual({
      attestedData: Uint8Array.from([1, 2, 3]),
      signature: new Uint8Array(65).fill(4),
    })
  })

  it.each<[string, Uint8Array, RegExp]>([
    ['truncated length', new Uint8Array(3), /truncated length/],
    ['truncated payload', CANONICAL_FRAME.slice(0, -1), /truncated payload/],
    ['trailing byte', Uint8Array.from([...CANONICAL_FRAME, 0]), /trailing bytes/],
    ['second frame', Uint8Array.from([...CANONICAL_FRAME, ...CANONICAL_FRAME]), /trailing bytes/],
    ['oversize declaration', Uint8Array.from([0, 160, 0, 1]), /payload exceeds size limit/],
    ['invalid UTF-8', framePayload(Uint8Array.from([0xff])), /malformed JSON/],
    ['invalid JSON', framePayload(new TextEncoder().encode('{')), /malformed JSON/],
    ['unknown field', frameJson({ ...validPayload(), other: [] }), /exactly/],
    ['missing field', frameJson({ attested_data: [1] }), /exactly/],
    [
      'duplicate field',
      framePayload(
        new TextEncoder().encode(
          `{"attested_data":[1],"attested_data":[2],"notary_signature":[${new Array(65).fill(4).join(',')}]}`,
        ),
      ),
      /malformed JSON/,
    ],
    ['short signature', frameJson(validPayload(new Array(64).fill(4))), /exactly 65/],
    ['long signature', frameJson(validPayload(new Array(66).fill(4))), /exactly 65/],
    ['negative byte', frameJson({ ...validPayload(), attested_data: [-1] }), /byte element/],
    ['large byte', frameJson({ ...validPayload(), attested_data: [256] }), /byte element/],
    ['fractional byte', frameJson({ ...validPayload(), attested_data: [1.5] }), /byte element/],
    ['string byte', frameJson({ ...validPayload(), attested_data: ['1'] }), /byte element/],
    [
      'oversize attested data',
      frameJson({ ...validPayload(), attested_data: new Array(2 * 1024 * 1024 + 1).fill(0) }),
      /invalid byte array/,
    ],
  ])('rejects %s', (_name, frame, reason) => {
    expect(() => decodeAttestationFrame(frame)).toThrow(reason)
  })
})
