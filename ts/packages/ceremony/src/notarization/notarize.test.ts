import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import {
  type ByteRange,
  correlateAttestation,
  type HashOpening,
  type NotarizationPlan,
  planNotarization,
  type Transcript,
} from './notarize.js'

const encoder = new TextEncoder()

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

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

function encodeAttestation(
  transcript: Transcript,
  plan: NotarizationPlan,
  hashes: { sent: readonly Uint8Array[]; recv: readonly Uint8Array[] },
  commitments = plan.commit,
): Uint8Array {
  return concat(
    new Uint8Array(32).fill(9),
    u64(1_770_000_000),
    u32(transcript.sent.length),
    u32(transcript.recv.length),
    encodeDirection(transcript.sent, plan.reveal.sent, commitments.sent, hashes.sent),
    encodeDirection(transcript.recv, plan.reveal.recv, commitments.recv, hashes.recv),
  )
}

function opening(transcript: Uint8Array, range: ByteRange, byte: number): HashOpening {
  const blinder = new Uint8Array(16).fill(byte)
  return {
    hash: sha256(concat(transcript.slice(range.start, range.end), blinder)),
    blinder,
  }
}

const transcript: Transcript = {
  sent: encoder.encode('abcdefghij'),
  recv: encoder.encode('0123456789ab'),
}

const ranges = {
  sent: [
    { start: 0, end: 2 },
    { start: 4, end: 7 },
  ],
  recv: [
    { start: 2, end: 5 },
    { start: 8, end: 12 },
  ],
}

describe('planNotarization', () => {
  it('validates and tiles both directions with the exact TLSNotary input shape', () => {
    expect(planNotarization(transcript, ranges)).toEqual({
      reveal: { sent: ranges.sent, recv: ranges.recv, server_identity: true },
      commit: {
        sent: [
          { start: 2, end: 4, algorithm: 'SHA256' },
          { start: 7, end: 10, algorithm: 'SHA256' },
        ],
        recv: [
          { start: 0, end: 2, algorithm: 'SHA256' },
          { start: 5, end: 8, algorithm: 'SHA256' },
        ],
      },
    })
  })

  it('accepts full reveal and full commitment without empty complement ranges', () => {
    expect(
      planNotarization(
        { sent: new Uint8Array(), recv: encoder.encode('abc') },
        { sent: [], recv: [{ start: 0, end: 3 }] },
      ).commit,
    ).toEqual({ sent: [], recv: [] })
    expect(
      planNotarization(
        { sent: encoder.encode('abc'), recv: new Uint8Array() },
        { sent: [], recv: [] },
      ).commit.sent,
    ).toEqual([{ start: 0, end: 3, algorithm: 'SHA256' }])
  })

  it.each([
    [
      'sent ceiling',
      { sent: new Uint8Array(4097), recv: new Uint8Array() },
      { sent: [], recv: [] },
    ],
    [
      'recv ceiling',
      { sent: new Uint8Array(), recv: new Uint8Array(32769) },
      { sent: [], recv: [] },
    ],
  ])('rejects the %s', (_name, bytes, reveal) => {
    expect(() => planNotarization(bytes, reveal)).toThrow(/exceeds/)
  })

  it.each<[string, readonly ByteRange[]]>([
    ['empty', [{ start: 1, end: 1 }]],
    ['negative', [{ start: -1, end: 1 }]],
    ['fractional', [{ start: 0, end: 1.5 }]],
    ['out of bounds', [{ start: 0, end: 11 }]],
    [
      'unordered',
      [
        { start: 4, end: 5 },
        { start: 2, end: 3 },
      ],
    ],
    [
      'overlapping',
      [
        { start: 1, end: 4 },
        { start: 3, end: 5 },
      ],
    ],
    [
      'duplicate',
      [
        { start: 1, end: 4 },
        { start: 1, end: 4 },
      ],
    ],
  ])('rejects %s reveal ranges', (_name, sent) => {
    expect(() => planNotarization(transcript, { sent, recv: [] })).toThrow(/reveal ranges/)
  })
})

describe('correlateAttestation', () => {
  const plan = planNotarization(transcript, ranges)
  const sent = plan.commit.sent.map((range, index) => opening(transcript.sent, range, index + 1))
  const recv = plan.commit.recv.map((range, index) => opening(transcript.recv, range, index + 3))
  const attestedData = encodeAttestation(transcript, plan, {
    sent: sent.map(({ hash }) => hash),
    recv: recv.map(({ hash }) => hash),
  })

  it('matches unordered TLSNotary openings to signed ranges in each direction', () => {
    const result = correlateAttestation(
      transcript,
      plan,
      { sent: [...sent].reverse(), recv: [...recv].reverse() },
      attestedData,
    )
    expect(result.sent).toEqual([
      { start: 2, end: 4, ...sent[0] },
      { start: 7, end: 10, ...sent[1] },
    ])
    expect(result.recv.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ])
    expect(result.decoded.createdAt).toBe('1770000000')
  })

  it('pins SHA-256 input order to hidden bytes followed by the 16-byte blinder', () => {
    const blinder = Uint8Array.from(Array.from({ length: 16 }, (_, index) => index))
    expect(Buffer.from(sha256(concat(transcript.sent.slice(2, 4), blinder))).toString('hex')).toBe(
      '2f83109b942b986213e9047e756ea35e066537f7a1297e9b368e7a481b53794f',
    )
    const onePlan = planNotarization(transcript, {
      sent: [
        { start: 0, end: 2 },
        { start: 4, end: transcript.sent.length },
      ],
      recv: [{ start: 0, end: transcript.recv.length }],
    })
    const hash = Uint8Array.from(
      Buffer.from('2f83109b942b986213e9047e756ea35e066537f7a1297e9b368e7a481b53794f', 'hex'),
    )
    expect(
      correlateAttestation(
        transcript,
        onePlan,
        { sent: [{ hash, blinder }], recv: [] },
        encodeAttestation(transcript, onePlan, { sent: [hash], recv: [] }),
      ).sent[0],
    ).toEqual({ start: 2, end: 4, hash, blinder })
  })

  it.each([
    ['missing opening', { sent: sent.slice(1), recv }, /opening count/],
    ['extra opening', { sent: [...sent, sent[0]], recv }, /opening count/],
    [
      'short hash',
      { sent: [{ ...sent[0], hash: new Uint8Array(31) }, sent[1]], recv },
      /hash must be exactly 32/,
    ],
    [
      'long blinder',
      { sent: [{ ...sent[0], blinder: new Uint8Array(17) }, sent[1]], recv },
      /blinder must be exactly 16/,
    ],
    [
      'changed hash',
      { sent: [{ ...sent[0], hash: new Uint8Array(32) }, sent[1]], recv },
      /one hidden/,
    ],
    ['cross-direction opening', { sent: recv, recv: sent }, /one hidden/],
  ] as const)('rejects %s', (_name, output, reason) => {
    expect(() => correlateAttestation(transcript, plan, output, attestedData)).toThrow(reason)
  })

  it('rejects a plan changed after complement derivation', () => {
    const changed: NotarizationPlan = {
      ...plan,
      commit: { ...plan.commit, sent: [plan.commit.sent[0], plan.commit.sent[0]] },
    }
    expect(() => correlateAttestation(transcript, changed, { sent, recv }, attestedData)).toThrow(
      /not the reveal complement/,
    )
  })

  it('requires the TLSNotary server-identity reveal', () => {
    const changed = structuredClone(plan) as NotarizationPlan
    Object.assign(changed.reveal, { server_identity: false })
    expect(() => correlateAttestation(transcript, changed, { sent, recv }, attestedData)).toThrow(
      /server identity/,
    )
  })

  it('rejects an opening that ambiguously matches equal hidden plaintext ranges', () => {
    const repeated: Transcript = { sent: encoder.encode('xAxA'), recv: new Uint8Array() }
    const repeatedPlan = planNotarization(repeated, {
      sent: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      recv: [],
    })
    const duplicate = opening(repeated.sent, repeatedPlan.commit.sent[0], 7)
    const signed = encodeAttestation(repeated, repeatedPlan, {
      sent: [duplicate.hash, duplicate.hash],
      recv: [],
    })
    expect(() =>
      correlateAttestation(
        repeated,
        repeatedPlan,
        { sent: [duplicate, duplicate], recv: [] },
        signed,
      ),
    ).toThrow(/does not identify one hidden range/)
  })

  it.each([
    [
      'signed transcript length',
      (() => {
        const changed = attestedData.slice()
        new DataView(changed.buffer).setUint32(40, transcript.sent.length + 1)
        return changed
      })(),
      /transcript length/,
    ],
    [
      'revealed byte',
      (() => {
        const changed = transcript.sent.slice()
        changed[0] ^= 1
        return encodeAttestation({ ...transcript, sent: changed }, plan, {
          sent: sent.map(({ hash }) => hash),
          recv: recv.map(({ hash }) => hash),
        })
      })(),
      /revealed range changed/,
    ],
    [
      'signed hash',
      encodeAttestation(transcript, plan, {
        sent: [new Uint8Array(32), sent[1].hash],
        recv: recv.map(({ hash }) => hash),
      }),
      /signed commitment hash changed/,
    ],
    [
      'duplicate signed hash',
      encodeAttestation(transcript, plan, {
        sent: [sent[0].hash, sent[0].hash],
        recv: recv.map(({ hash }) => hash),
      }),
      /signed commitment hash changed/,
    ],
    [
      'missing signed commitment',
      encodeAttestation(
        transcript,
        plan,
        { sent: [sent[0].hash], recv: recv.map(({ hash }) => hash) },
        { ...plan.commit, sent: [plan.commit.sent[0]] },
      ),
      /commitment count changed/,
    ],
    [
      'extra signed commitment',
      encodeAttestation(
        transcript,
        plan,
        {
          sent: [sent[0].hash, sent[0].hash, sent[1].hash],
          recv: recv.map(({ hash }) => hash),
        },
        {
          ...plan.commit,
          sent: [
            { start: 2, end: 3, algorithm: 'SHA256' },
            { start: 3, end: 4, algorithm: 'SHA256' },
            plan.commit.sent[1],
          ],
        },
      ),
      /commitment count changed/,
    ],
    [
      'signed commitment range',
      encodeAttestation(
        transcript,
        plan,
        { sent: sent.map(({ hash }) => hash), recv: recv.map(({ hash }) => hash) },
        {
          ...plan.commit,
          sent: [{ start: 2, end: 3, algorithm: 'SHA256' }, plan.commit.sent[1]],
        },
      ),
      /commitment range changed/,
    ],
  ] as const)('rejects a changed %s', (_name, signed, reason) => {
    expect(() => correlateAttestation(transcript, plan, { sent, recv }, signed)).toThrow(reason)
  })
})

it('coalesces adjacent disclosures in both directions before signing [LIBID-PROVER-009]', () => {
  const selected = {
    sent: [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 7 },
    ],
    recv: [
      { start: 2, end: 5 },
      { start: 5, end: 8 },
    ],
  }
  const original = structuredClone(selected)
  const plan = planNotarization(transcript, selected)
  // Expected native RangeSet serialization, independent of the planner's partition.
  const native = {
    ...plan,
    reveal: {
      sent: [{ start: 0, end: 7 }],
      recv: [{ start: 2, end: 8 }],
      server_identity: true as const,
    },
  }
  expect(plan.reveal).toEqual(native.reveal)
  expect(selected).toEqual(original)
  const openings = {
    sent: plan.commit.sent.map((range, i) => opening(transcript.sent, range, i + 1)),
    recv: plan.commit.recv.map((range, i) => opening(transcript.recv, range, i + 4)),
  }
  const signed = encodeAttestation(transcript, native, {
    sent: openings.sent.map((o) => o.hash),
    recv: openings.recv.map((o) => o.hash),
  })
  expect(
    correlateAttestation(transcript, plan, openings, signed).decoded.received.revealed,
  ).toHaveLength(1)
  const changed = { ...transcript, recv: transcript.recv.slice() }
  changed.recv[3] ^= 1
  expect(() => correlateAttestation(changed, plan, openings, signed)).toThrow(
    /revealed range changed/,
  )
})
