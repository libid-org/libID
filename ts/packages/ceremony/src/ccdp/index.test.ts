import { describe, expect, it } from 'vitest'
import {
  origin,
  redirect,
  AbortCeremony,
  AppStartProver,
  CancelCeremony,
  PrefetchStarted,
  ProverReady,
  ProverNotifyEvent,
  ProverIdentityProof,
} from './index.js'
import { readPrefetch, readProver, proverFragment, prefetchFragment } from './navigation.js'
const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'
describe('CCDP v1 [LIBID-MOD-016] [LIBID-OAUTH-022]', () => {
  const samples = [
    [AbortCeremony, { type: 'abort-ceremony', code: 'proof', reason: 'Proof engine failed.' }],
    [
      AppStartProver,
      {
        type: 'app-start-prover',
        platformId: 'google',
        platformCeremonyVersion: 1,
        clientId: 'client',
        redirectUri: 'https://bridge.test/callback',
        codeVerifier: null,
        notaryAddress: null,
      },
    ],
    [CancelCeremony, { type: 'cancel-ceremony' }],
    [PrefetchStarted, { type: 'prefetch-started' }],
    [ProverReady, { type: 'prover-ready' }],
    [
      ProverNotifyEvent,
      {
        type: 'prover-notify-event',
        platformStep: { code: 'proof', label: 'Proof', status: 'started', progress: 0 },
        timestamp: 1,
      },
    ],
    [
      ProverIdentityProof,
      {
        type: 'prover-identity-proof',
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
        expect(AppStartProver.decode(value)).toBe(value)
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
        expect(() => AppStartProver.decode({ ...message, platformId, notaryAddress })).toThrow()
    }
    for (const notaryAddress of [undefined, '', 'https://notary.test'])
      expect(() => AppStartProver.decode({ ...message, notaryAddress })).toThrow()
    for (const extra of [
      { ledgerId: 'test:mainnet' },
      { isTestnet: false },
      { chainId: new Uint8Array(32) },
    ])
      expect(() => AppStartProver.decode({ ...message, ...extra })).toThrow()
  })
  it('rejects malformed progress without coercion', () => {
    const message = samples[5][1]
    for (const progress of [NaN, Infinity, -1, 1, '0'])
      expect(() =>
        ProverNotifyEvent.decode({
          ...message,
          platformStep: { ...message.platformStep, progress },
        }),
      ).toThrow()
    expect(() =>
      ProverNotifyEvent.decode({
        ...message,
        platformStep: { ...message.platformStep, status: { toString: () => 'started' } },
      }),
    ).toThrow()
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
  expect(() =>
    ProverIdentityProof.decode({ type: 'prover-identity-proof', identity, proof: null }),
  ).toThrow()
})
it('rejects the retired delivery message and embedded-identity shape', () => {
  expect(() => ProverIdentityProof.decode({ type: 'prover-deliver-proof', proof: {} })).toThrow()
  expect(() =>
    ProverIdentityProof.decode({ type: 'prover-identity-proof', proof: { identity: {} } }),
  ).toThrow()
})

it('admits explicit loopback HTTP without widening public URL validation [LIBID-OAUTH-021]', () => {
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
