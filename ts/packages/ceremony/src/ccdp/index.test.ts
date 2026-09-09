import { describe, expect, it } from 'vitest'
import {
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
        ledgerId: 'test:mainnet',
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
  it('checks ledger string structure and leaves semantic decoding to Prover [LIBID-OAUTH-021]', () => {
    const message = samples[1][1]
    for (const ledgerId of ['test:mainnet', 'test:testnet', 'unknown:1']) {
      const value = { ...message, ledgerId }
      expect(AppStartProver.decode(value)).toBe(value)
    }
    for (const ledgerId of [undefined, null, 0, true, {}, new String('test:mainnet')])
      expect(() => AppStartProver.decode({ ...message, ledgerId })).toThrow()
    for (const extra of [
      { isTestnet: false },
      { chainId: new Uint8Array(32) },
      { notaryAddress: 'https://other.test' },
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
