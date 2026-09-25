import { expect, it } from 'vitest'
import { type PlatformId, platforms } from '../../platforms/index.js'
import { proofProgress } from './progress.js'

const progressFor = (platform: PlatformId) =>
  proofProgress(platforms[platform].versions[1].progressWeights)

const proofOperations = [
  'proof-worker-bootstrap',
  'proof-circuit-load',
  'proof-wasm-load',
  'proof-backend-initialization',
  'circuit-inputs',
  'witness',
  'proof',
]
const platformOperations = {
  google: ['signing-key-fetch'],
  x: ['token-fetch', 'token-attestation', 'identity-fetch', 'identity-attestation'],
  github: ['token-fetch', 'token-attestation', 'identity-fetch', 'identity-attestation'],
}
const finished = (event: string) =>
  ({
    event,
    phase: 'finished',
    timestamp: 1,
    status: 'active',
  }) as const

it.each(['google', 'x', 'github'] as const)(
  'counts each %s operation once in different completion orders [LIBID-PROVER-011]',
  (platform) => {
    const operations = [...proofOperations, ...platformOperations[platform]]
    for (const order of [operations, [...operations].reverse()]) {
      const progress = progressFor(platform)
      let previous = 0
      for (const event of order) {
        expect(progress({ ...finished(event), phase: 'started' })).toBeUndefined()
        expect(
          progress({ ...finished(event), instrumentation: { operationId: 'another-operation' } }),
        ).toBeUndefined()
        const next = progress(finished(event))!
        expect(next).toBeGreaterThan(previous)
        expect(next).toBeLessThanOrEqual(1)
        expect(progress(finished(event))).toBeUndefined()
        previous = next
      }
      expect(previous).toBe(1)
      for (const event of [
        'prover',
        'zk-proof-preparation',
        'zk-proof-generation',
        'proof-backend-destroy',
        'extension',
      ])
        expect(progress(finished(event))).toBeUndefined()
      expect(
        progress({ status: 'failed', event: 'prover', message: 'failed', timestamp: 2 }),
      ).toBeUndefined()
    }
  },
)

it('keeps late attestations separate from finished ZK work [LIBID-BROWSER-024]', () => {
  const progress = progressFor('x')
  for (const event of [...proofOperations, 'token-fetch']) progress(finished(event))
  const beforeAttestations = progress(finished('identity-fetch'))!
  expect(progress(finished('zk-proof-generation'))).toBeUndefined()
  const token = progress(finished('token-attestation'))!
  const identity = progress(finished('identity-attestation'))!
  expect(token).toBeGreaterThan(beforeAttestations)
  expect(token).toBeLessThan(1)
  expect(identity).toBeGreaterThan(token)
  expect(identity).toBe(1)
  expect(progressFor('google')(finished('identity-attestation'))).toBeUndefined()
  expect(progressFor('github')(finished('token-fetch'))).toBeGreaterThan(0)
})
