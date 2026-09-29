import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { concat, encodeAttestation, opening } from './fixtures/attestation.js'
import { correlateAttestation, type NotarizationPlan, planNotarization } from './notarize.js'
import type { ByteRange, Transcript } from './protocol.js'

const encoder = new TextEncoder()

const transcript: Transcript = {
  sent: encoder.encode('abcdefghij'),
  received: encoder.encode('0123456789ab'),
}

const ranges = {
  sent: [
    { start: 0, end: 2 },
    { start: 4, end: 7 },
  ],
  received: [
    { start: 2, end: 5 },
    { start: 8, end: 12 },
  ],
}

describe('planNotarization', () => {
  it('validates and tiles both directions with the exact TLSNotary input shape', () => {
    expect(planNotarization(transcript, ranges)).toEqual({
      reveal: { sent: ranges.sent, received: ranges.received, server_identity: true },
      commit: {
        sent: [
          { start: 2, end: 4, algorithm: 'SHA256' },
          { start: 7, end: 10, algorithm: 'SHA256' },
        ],
        received: [
          { start: 0, end: 2, algorithm: 'SHA256' },
          { start: 5, end: 8, algorithm: 'SHA256' },
        ],
      },
    })
  })

  it('accepts full reveal and full commitment without empty complement ranges', () => {
    expect(
      planNotarization(
        { sent: new Uint8Array(), received: encoder.encode('abc') },
        { sent: [], received: [{ start: 0, end: 3 }] },
      ).commit,
    ).toEqual({ sent: [], received: [] })
    expect(
      planNotarization(
        { sent: encoder.encode('abc'), received: new Uint8Array() },
        { sent: [], received: [] },
      ).commit.sent,
    ).toEqual([{ start: 0, end: 3, algorithm: 'SHA256' }])
  })

  it.each([
    [
      'sent ceiling',
      { sent: new Uint8Array(4097), received: new Uint8Array() },
      { sent: [], received: [] },
    ],
    [
      'received ceiling',
      { sent: new Uint8Array(), received: new Uint8Array(32769) },
      { sent: [], received: [] },
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
    expect(() => planNotarization(transcript, { sent, received: [] })).toThrow(/reveal ranges/)
  })
})

describe('correlateAttestation', () => {
  const plan = planNotarization(transcript, ranges)
  const sent = plan.commit.sent.map((range, index) => opening(transcript.sent, range, index + 1))
  const received = plan.commit.received.map((range, index) =>
    opening(transcript.received, range, index + 3),
  )
  const attestedData = encodeAttestation(transcript, plan, {
    sent: sent.map(({ hash }) => hash),
    received: received.map(({ hash }) => hash),
  })

  it('rejects a signed authority differing from the session target', () => {
    const changed = attestedData.slice()
    changed[0] ^= 1
    expect(() =>
      correlateAttestation('api.x.com', transcript, plan, { sent, received }, changed),
    ).toThrow(/authority/)
  })

  it('matches unordered TLSNotary openings to signed ranges in each direction', () => {
    const result = correlateAttestation(
      'api.x.com',
      transcript,
      plan,
      { sent: [...sent].reverse(), received: [...received].reverse() },
      attestedData,
    )
    expect(result.sent).toEqual([
      { start: 2, end: 4, ...sent[0] },
      { start: 7, end: 10, ...sent[1] },
    ])
    expect(result.received.map(({ start, end }) => ({ start, end }))).toEqual([
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
      received: [{ start: 0, end: transcript.received.length }],
    })
    const hash = Uint8Array.from(
      Buffer.from('2f83109b942b986213e9047e756ea35e066537f7a1297e9b368e7a481b53794f', 'hex'),
    )
    expect(
      correlateAttestation(
        'api.x.com',
        transcript,
        onePlan,
        { sent: [{ hash, blinder }], received: [] },
        encodeAttestation(transcript, onePlan, { sent: [hash], received: [] }),
      ).sent[0],
    ).toEqual({ start: 2, end: 4, hash, blinder })
  })

  it.each([
    ['missing opening', { sent: sent.slice(1), received }, /opening count/],
    ['extra opening', { sent: [...sent, sent[0]], received }, /opening count/],
    [
      'short hash',
      { sent: [{ ...sent[0], hash: new Uint8Array(31) }, sent[1]], received },
      /hash must be exactly 32/,
    ],
    [
      'long blinder',
      { sent: [{ ...sent[0], blinder: new Uint8Array(17) }, sent[1]], received },
      /blinder must be exactly 16/,
    ],
    [
      'changed hash',
      { sent: [{ ...sent[0], hash: new Uint8Array(32) }, sent[1]], received },
      /one hidden/,
    ],
    ['cross-direction opening', { sent: received, received: sent }, /one hidden/],
  ] as const)('rejects %s', (_name, output, reason) => {
    expect(() => correlateAttestation('api.x.com', transcript, plan, output, attestedData)).toThrow(
      reason,
    )
  })

  it('rejects a plan changed after complement derivation', () => {
    const changed: NotarizationPlan = {
      ...plan,
      commit: { ...plan.commit, sent: [plan.commit.sent[0], plan.commit.sent[0]] },
    }
    expect(() =>
      correlateAttestation('api.x.com', transcript, changed, { sent, received }, attestedData),
    ).toThrow(/not the reveal complement/)
  })

  it('requires the TLSNotary server-identity reveal', () => {
    const changed = structuredClone(plan) as NotarizationPlan
    Object.assign(changed.reveal, { server_identity: false })
    expect(() =>
      correlateAttestation('api.x.com', transcript, changed, { sent, received }, attestedData),
    ).toThrow(/server identity/)
  })

  it('rejects an opening that ambiguously matches equal hidden plaintext ranges', () => {
    const repeated: Transcript = { sent: encoder.encode('xAxA'), received: new Uint8Array() }
    const repeatedPlan = planNotarization(repeated, {
      sent: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      received: [],
    })
    const duplicate = opening(repeated.sent, repeatedPlan.commit.sent[0], 7)
    const signed = encodeAttestation(repeated, repeatedPlan, {
      sent: [duplicate.hash, duplicate.hash],
      received: [],
    })
    expect(() =>
      correlateAttestation(
        'api.x.com',
        repeated,
        repeatedPlan,
        { sent: [duplicate, duplicate], received: [] },
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
          received: received.map(({ hash }) => hash),
        })
      })(),
      /revealed range changed/,
    ],
    [
      'signed hash',
      encodeAttestation(transcript, plan, {
        sent: [new Uint8Array(32), sent[1].hash],
        received: received.map(({ hash }) => hash),
      }),
      /signed commitment hash changed/,
    ],
    [
      'duplicate signed hash',
      encodeAttestation(transcript, plan, {
        sent: [sent[0].hash, sent[0].hash],
        received: received.map(({ hash }) => hash),
      }),
      /signed commitment hash changed/,
    ],
    [
      'missing signed commitment',
      encodeAttestation(
        transcript,
        plan,
        { sent: [sent[0].hash], received: received.map(({ hash }) => hash) },
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
          received: received.map(({ hash }) => hash),
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
        { sent: sent.map(({ hash }) => hash), received: received.map(({ hash }) => hash) },
        {
          ...plan.commit,
          sent: [{ start: 2, end: 3, algorithm: 'SHA256' }, plan.commit.sent[1]],
        },
      ),
      /commitment range changed/,
    ],
  ] as const)('rejects a changed %s', (_name, signed, reason) => {
    expect(() =>
      correlateAttestation('api.x.com', transcript, plan, { sent, received }, signed),
    ).toThrow(reason)
  })
})

it('coalesces adjacent disclosures in both directions before signing [LIBID-PROVER-009]', () => {
  const selected = {
    sent: [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 7 },
    ],
    received: [
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
      received: [{ start: 2, end: 8 }],
      server_identity: true as const,
    },
  }
  expect(plan.reveal).toEqual(native.reveal)
  expect(selected).toEqual(original)
  const openings = {
    sent: plan.commit.sent.map((range, i) => opening(transcript.sent, range, i + 1)),
    received: plan.commit.received.map((range, i) => opening(transcript.received, range, i + 4)),
  }
  const signed = encodeAttestation(transcript, native, {
    sent: openings.sent.map((o) => o.hash),
    received: openings.received.map((o) => o.hash),
  })
  expect(
    correlateAttestation('api.x.com', transcript, plan, openings, signed).decoded.received.revealed,
  ).toHaveLength(1)
  const changed = { ...transcript, received: transcript.received.slice() }
  changed.received[3] ^= 1
  expect(() => correlateAttestation('api.x.com', changed, plan, openings, signed)).toThrow(
    /revealed range changed/,
  )
})
