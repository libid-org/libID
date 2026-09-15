import { describe, expect, it } from 'vitest'
import { origin } from '../primitives.js'
import {
  CeremonyFailed,
  Event,
  IdentityProof,
  ProveIdentity,
  redirect,
  UserDenied,
} from './index.js'
import { prefetchFragment, proverFragment, readPrefetch, readProver } from './navigation.js'

const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'

describe('CCDP v1 [LIBID-MOD-016] [LIBID-OAUTH-022]', () => {
  const samples = [
    [
      CeremonyFailed,
      { type: 'ceremony-failed', event: 'proof', message: 'Unexpected proving failure.' },
    ],
    [
      ProveIdentity,
      {
        type: 'prove-identity',
        platformId: 'google',
        platformCeremonyVersion: 1,
        clientId: 'client',
        redirectUri: 'https://bridge.test/callback',
        codeVerifier: null,
        notaryAddress: null,
      },
    ],
    [UserDenied, { type: 'user-denied' }],
    [Event, { type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 }],
    [Event, { type: 'event', event: 'prover', phase: 'started', timestamp: 2 }],
    [
      Event,
      {
        type: 'event',
        event: 'proof',
        phase: 'started',
        timestamp: 1,
      },
    ],
    [
      IdentityProof,
      {
        type: 'identity-proof',
        identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
        proof: { arbitrary: true },
      },
    ],
  ] as const
  for (const [codec, value] of samples)
    it(codec.type, () => {
      expect(codec.decode(value)).toBe(value)
      expect(() => codec.decode({ ...value, ceremonyId: id })).toThrow()
      expect(() => codec.decode({ ...value, type: 'other' })).toThrow()
      expect(() => codec.decode(Object.assign(new Date(), value))).toThrow()
    })
  it('validates nullable notary routing independently of platform [LIBID-OAUTH-021]', () => {
    const message = samples[1][1]
    for (const platformId of ['google', 'x', 'github', 'new-platform']) {
      for (const notaryAddress of [
        null,
        'https://notary.test',
        'https://localhost:4687',
        'http://localhost:4687',
      ]) {
        const value = { ...message, platformId, notaryAddress }
        expect(ProveIdentity.decode(value)).toBe(value)
        expect(() =>
          ProveIdentity.decode({ ...value, tokenExchangeCredential: 'retired' }),
        ).toThrow()
      }
      for (const notaryAddress of [
        undefined,
        0,
        {},
        'http://notary.test',
        'https://notary.test/',
        'https://user@notary.test',
        'https://notary.test?x=1',
        'https://notary.test#x',
      ])
        expect(() => ProveIdentity.decode({ ...message, platformId, notaryAddress })).toThrow()
    }
    for (const extra of [
      { ledgerId: 'test:mainnet' },
      { isTestnet: false },
      { chainId: new Uint8Array(32) },
    ])
      expect(() => ProveIdentity.decode({ ...message, ...extra })).toThrow()
  })
  it('validates nullable code verifiers without deciding platform applicability [LIBID-OAUTH-021]', () => {
    for (const platformId of ['google', 'x', 'github', 'new-platform']) {
      for (const codeVerifier of [null, 'A'.repeat(43)]) {
        const value = { ...samples[1][1], platformId, codeVerifier }
        expect(ProveIdentity.decode(value)).toBe(value)
        expect(() =>
          ProveIdentity.decode({ ...value, tokenExchangeCredential: 'retired' }),
        ).toThrow()
      }
      for (const codeVerifier of [
        undefined,
        '',
        'A'.repeat(42),
        '+'.repeat(43),
        `${'A'.repeat(43)}=`,
      ])
        expect(() => ProveIdentity.decode({ ...samples[1][1], platformId, codeVerifier })).toThrow()
    }
  })
  it('validates the optional public credential independently of platform [TEST-CCDP-05]', () => {
    for (const platformId of ['google', 'x', 'github', 'new-platform']) {
      const base = { ...samples[1][1], platformId }
      const value = { ...base, clientCredential: 'public&credential=1' }
      expect(ProveIdentity.decode(value)).toBe(value)
      expect(() => ProveIdentity.decode({ ...value, tokenExchangeCredential: 'retired' })).toThrow()
      expect(ProveIdentity.decode(base)).toBe(base)
      for (const clientCredential of [
        undefined,
        null,
        '',
        1,
        [],
        'has space',
        'tail\n',
        '\t',
        'é',
        '\x7f',
      ])
        expect(() => ProveIdentity.decode({ ...base, clientCredential })).toThrow()
    }
  })

  it('rejects malformed event records and terminal claims without coercion', () => {
    const message = samples[5][1]
    for (const timestamp of [NaN, Infinity, -1, '0'])
      expect(() => Event.decode({ ...message, timestamp })).toThrow()
    for (const extra of [
      { status: 'completed' },
      { stage: 'zk-proving' },
      { phase: 'failed' },
      { proof: 'secret' },
      { attributes: { bytes: Infinity } },
    ])
      expect(() => Event.decode({ ...message, ...extra })).toThrow()
  })
  it('preserves private return components with one outer encoding [LIBID-OAUTH-026]', () => {
    const input = { query: `?code=a%2Bb&state=v1.${id}`, fragment: '' }
    expect(readProver(String(proverFragment(id, 'https://app.test', input)))).toEqual({
      ceremonyId: id,
      applicationOrigin: 'https://app.test',
      oauthReturn: input,
    })
    expect(readPrefetch(String(prefetchFragment(id, 'x', 1))).platformId).toBe('x')
    for (const extra of [`&ceremonyId=${id}`, '&other=1'])
      expect(() =>
        readProver(String(proverFragment(id, 'https://app.test', input)) + extra),
      ).toThrow()
    expect(() =>
      readProver(
        `ceremonyId=${id}&applicationOrigin=https%3A%2F%2Fapp.test&oauthQuery=%FF&oauthFragment=`,
      ),
    ).toThrow()
  })
})

it.each([
  null,
  {},
  { platformId: 'google', oauthClientId: 'client', userId: 1, userName: 'a' },
  { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a', extra: true },
  { platformId: 'google', oauthClientId: 'client', userId: '1', userName: '\n' },
])('rejects malformed shared identities [LIBID-MOD-016]', (identity) => {
  expect(() => IdentityProof.decode({ type: 'identity-proof', identity, proof: null })).toThrow()
})

it('rejects the retired delivery message and embedded-identity shape', () => {
  expect(() => IdentityProof.decode({ type: 'prover-deliver-proof', proof: {} })).toThrow()
  expect(() => IdentityProof.decode({ type: 'identity-proof', proof: { identity: {} } })).toThrow()
})

it('admits explicit loopback HTTP without widening public URL validation [LIBID-OAUTH-021]', () => {
  for (const suffix of ['?', '#', '?x=1', '#x']) {
    const redirectUri = `https://bridge.test/callback${suffix}`
    expect(redirect(redirectUri)).toBe(false)
    expect(() =>
      ProveIdentity.decode({
        type: 'prove-identity',
        platformId: 'google',
        platformCeremonyVersion: 1,
        clientId: 'client',
        redirectUri,
        codeVerifier: null,
        notaryAddress: null,
      }),
    ).toThrow()
  }
  for (const value of ['http://localhost:4682', 'http://127.0.0.1:4682']) {
    expect(origin(value)).toBe(true)
    expect(redirect(`${value}/auth/callback`)).toBe(true)
  }
  for (const value of [
    'http://bridge.test',
    'http://localhost.evil.test',
    'http://192.168.1.1',
    'http://localtest.me',
    'http://localhost.',
    'http://user@localhost',
    'http://LOCALHOST',
    'http://127.1',
  ]) {
    expect(origin(value), value).toBe(false)
    expect(redirect(`${value}/auth/callback`), value).toBe(false)
  }
})

it('supports bounded extension observations and disambiguated operations [LIBID-MOD-016]', () => {
  for (const event of [
    {
      type: 'event',
      event: 'resource-request',
      timestamp: 1,
      instrumentation: { attributes: { bytes: 1024, cache: 'hit' } },
    },
    {
      type: 'event',
      event: 'tls-session',
      phase: 'started',
      instrumentation: { operationId: 'identity' },
      timestamp: 1,
    },
    {
      type: 'event',
      event: 'tls-session',
      phase: 'finished',
      instrumentation: { operationId: 'identity' },
      timestamp: 2,
    },
    { type: 'event', event: 'prover-fallback', timestamp: 3 },
  ])
    expect(Event.decode(event)).toBe(event)
  for (const event of [
    { event: 'prover-fallback', phase: 'started' },
    { event: 'prover' },
    { event: 'prover', phase: 'started', instrumentation: { operationId: 'extra' } },
    { event: 'some-event', phase: 'unknown' },
    { event: 'unknown', instrumentation: { operationId: '' } },
    { event: 'unknown', instrumentation: { attributes: { data: {} } } },
    {
      event: 'unknown',
      instrumentation: {
        attributes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`field-${i}`, i])),
      },
    },
  ])
    expect(() => Event.decode({ type: 'event', timestamp: 1, ...event })).toThrow()
})

it.each(['https://app.test', 'http://localhost:4681', 'http://127.0.0.1:4681'])(
  'preserves the exact Application origin %s in the private fragment [TEST-CCDP-03]',
  (applicationOrigin) => {
    const fragment = proverFragment(id, applicationOrigin, {
      query: '?code=a%2Bb',
      fragment: '#state=x',
    })
    expect([...fragment.keys()]).toEqual([
      'ceremonyId',
      'applicationOrigin',
      'oauthQuery',
      'oauthFragment',
    ])
    expect(readProver(String(fragment)).applicationOrigin).toBe(applicationOrigin)
    fragment.append('applicationOrigin', applicationOrigin)
    expect(() => readProver(String(fragment))).toThrow()
    fragment.delete('applicationOrigin')
    expect(() => readProver(String(fragment))).toThrow()
  },
)

it.each([
  '',
  '*',
  'null',
  'http://app.test',
  'https://app.test/',
  'https://app.test:443',
  'https://u@app.test',
])(
  'rejects invalid Application origin %s before accepting Prover [TEST-CCDP-04]',
  (applicationOrigin) => {
    expect(() =>
      readProver(String(proverFragment(id, applicationOrigin, { query: '', fragment: '' }))),
    ).toThrow()
  },
)

it('accepts only the current outcome names [TEST-CCDP-05]', () => {
  for (const type of ['cancel', 'denied', 'abort']) {
    const value =
      type === 'abort' ? { type, event: 'prover', message: 'Retired message' } : { type }
    for (const codec of [UserDenied, CeremonyFailed, ProveIdentity, IdentityProof, Event])
      expect(() => codec.decode(value)).toThrow()
  }
})

it('validates the exact optional instrumentation record [TEST-CCDP-06]', () => {
  const value = { type: 'event', event: 'session', phase: 'started', timestamp: 1 }
  for (const instrumentation of [
    {},
    { operationId: 'first' },
    { attributes: {} },
    { operationId: 'first', attributes: { bytes: 1, cached: true, source: 'worker' } },
  ])
    expect(Event.decode({ ...value, instrumentation })).toMatchObject({ instrumentation })
  expect(Event.decode(value)).not.toHaveProperty('instrumentation')
  for (const instrumentation of [
    null,
    undefined,
    [],
    new Date(),
    { unknown: true },
    { operationId: null },
    { operationId: undefined },
    { operationId: '' },
    { operationId: 'x'.repeat(65) },
    { attributes: null },
    { attributes: undefined },
    { attributes: [] },
    { attributes: { bytes: Infinity } },
    { attributes: { bytes: NaN } },
    { attributes: { text: 'x'.repeat(129) } },
    { attributes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`field-${i}`, i])) },
  ])
    expect(() => Event.decode({ ...value, instrumentation })).toThrow()
  for (const extra of [{ operationId: 'first' }, { attributes: {} }])
    expect(() => Event.decode({ ...value, ...extra })).toThrow()
})
