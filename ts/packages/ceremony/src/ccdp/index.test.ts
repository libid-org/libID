import { describe, expect, it } from 'vitest'
import {
  AbortCeremony,
  AppStartProver,
  CancelCeremony,
  PrefetchStarted,
  ProverReady,
  ProverNotifyEvent,
  ProverDeliverProof,
} from './index.js'
import { readPrefetch, readProver, proverFragment, prefetchFragment } from './navigation.js'
const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'
describe('CCDP v1 [LIBID-MOD-016] [LIBID-OAUTH-022]', () => {
  const samples = [
    [AbortCeremony, { type: 'abort-ceremony', reason: 'Failed' }],
    [
      AppStartProver,
      {
        type: 'app-start-prover',
        platformId: 'google',
        platformCeremonyVersion: 1,
        clientId: 'client',
        redirectUri: 'https://bridge.test/callback',
        codeVerifier: null,
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
    [ProverDeliverProof, { type: 'prover-deliver-proof', proof: { arbitrary: true } }],
  ] as const
  for (const [codec, value] of samples)
    it(codec.type, () => {
      expect(codec.decode(value)).toBe(value)
      expect(() => codec.decode({ ...value, ceremonyId: id })).toThrow()
      expect(() => codec.decode({ ...value, type: 'other' })).toThrow()
      expect(() => codec.decode(Object.assign(new Date(), value))).toThrow()
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
