import { describe, expect, it } from 'vitest'
import { origin } from '../primitives.js'
import { Abort, Cancel, Event, IdentityProof, ProveIdentity, redirect } from './index.js'
import { prefetchFragment, proverFragment, readPrefetch, readProver } from './navigation.js'

const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'

describe('CCDP v1 [LIBID-MOD-016] [LIBID-OAUTH-022]', () => {
  const samples = [
    [Abort, { type: 'abort', event: 'proof', message: 'Unexpected proving failure.' }],
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
    [Cancel, { type: 'cancel' }],
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
  it('validates platform-specific notary routing without ledger decoding [LIBID-OAUTH-021]', () => {
    const message = samples[1][1]
    for (const platformId of ['x', 'github']) {
      for (const notaryAddress of [
        'https://notary.test',
        'https://localhost:4687',
        'http://localhost:4687',
      ]) {
        const value = { ...message, platformId, notaryAddress }
        expect(ProveIdentity.decode(value)).toBe(value)
      }
      for (const notaryAddress of [
        undefined,
        null,
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
    for (const notaryAddress of [undefined, '', 'https://notary.test'])
      expect(() => ProveIdentity.decode({ ...message, notaryAddress })).toThrow()
    for (const extra of [
      { ledgerId: 'test:mainnet' },
      { isTestnet: false },
      { chainId: new Uint8Array(32) },
    ])
      expect(() => ProveIdentity.decode({ ...message, ...extra })).toThrow()
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
    expect(readProver(String(proverFragment(id, input)))).toEqual({
      ceremonyId: id,
      oauthReturn: input,
    })
    expect(readPrefetch(String(prefetchFragment(id, 'x', 1))).platformId).toBe('x')
    for (const extra of [`&ceremonyId=${id}`, '&other=1'])
      expect(() => readProver(String(proverFragment(id, input)) + extra)).toThrow()
    expect(() => readProver(`ceremonyId=${id}&oauthQuery=%FF&oauthFragment=`)).toThrow()
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
      attributes: { bytes: 1024, cache: 'hit' },
    },
    {
      type: 'event',
      event: 'tls-session',
      phase: 'started',
      operationId: 'identity',
      timestamp: 1,
    },
    {
      type: 'event',
      event: 'tls-session',
      phase: 'finished',
      operationId: 'identity',
      timestamp: 2,
    },
    { type: 'event', event: 'prover-fallback', timestamp: 3 },
  ])
    expect(Event.decode(event)).toBe(event)
  for (const event of [
    { event: 'prover-fallback', phase: 'started' },
    { event: 'prover' },
    { event: 'prover', phase: 'started', operationId: 'extra' },
    { event: 'some-event', phase: 'unknown' },
    { event: 'unknown', operationId: '' },
    { event: 'unknown', attributes: { data: {} } },
    {
      event: 'unknown',
      attributes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`field-${i}`, i])),
    },
  ])
    expect(() => Event.decode({ type: 'event', timestamp: 1, ...event })).toThrow()
})
