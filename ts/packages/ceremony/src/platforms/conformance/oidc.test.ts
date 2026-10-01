import { describe, expect, it, vi } from 'vitest'
import { fixtures, oidcPlatforms } from '../../testing/index.js'
import type { EvidenceChange } from './fixtures.js'
import { destroy, generate, notarization } from './mocks.js'
import {
  beforeProving,
  expectNoProvingWork,
  oidcFailures,
  proverKinds,
  proverOf,
  stageOidc,
  tagged,
} from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

describe.each(oidcPlatforms)('%s OIDC prover', (platformId) => {
  const fixture = fixtures[platformId]
  const tags = `${proverKinds.oidc.tags} [LIBID-OAUTH-007] [LIBID-OAUTH-021] ${fixture.specTests.prover}`

  it.each(Object.entries(fixture.rejectedBinding))(
    'rejects a well-formed proof with a mismatched %s [LIBID-OAUTH-014]',
    (_change, rebind) => {
      const { identity, proof } = rebind(fixture)
      expect(() => fixture.validation.validateProof(proof, identity, fixture.digest)).toThrow(
        'public input mismatch',
      )
    },
  )

  it.each(Object.entries(fixture.rejectedEvidence))(
    tagged('rejects evidence with %s before generating a proof', tags),
    async (_name, change: EvidenceChange) => {
      const staged = stageOidc(platformId, 'accepted', {
        idToken: change.idToken?.(fixture.evidence.idToken),
        jwk: change.jwk?.(fixture.evidence.jwk),
      })
      await expect((await proverOf(platformId)).prove(staged.context)).rejects.toMatchObject({
        event: change.rejectedAt,
        ...(change.message === undefined ? {} : { message: change.message }),
      })
      if (change.rejectedAt === 'authorization') expectNoProvingWork(staged.keys)
      expect(generate).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  )

  it(tagged('accepts its published signing key without optional members', tags), async () => {
    const staged = stageOidc(platformId, 'accepted', { jwk: fixture.evidence.minimalJwk })
    await expect((await proverOf(platformId)).prove(staged.context)).resolves.toEqual({
      identity: fixture.identity,
      proof: fixture.proof,
    })
  })

  it(
    tagged(
      'fetches its published signing key once, without credentials or redirects, and opens no notary connection',
      tags,
    ),
    async () => {
      const staged = stageOidc(platformId, 'accepted')
      await (await proverOf(platformId)).prove(staged.context)
      expect(staged.keys).toHaveBeenCalledOnce()
      expect(new URL(staged.keys.mock.calls[0][0]).protocol).toBe('https:')
      expect(staged.keys.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
      // The supplied notary address never opens a notary connection for this prover.
      expect(notarization).not.toHaveBeenCalled()
    },
  )

  it.each(Object.keys(oidcFailures) as (keyof typeof oidcFailures)[])(
    tagged('rejects %s before generating a proof', tags),
    async (outcome) => {
      const staged = stageOidc(platformId, outcome)
      await expect((await proverOf(platformId)).prove(staged.context)).rejects.toMatchObject(
        oidcFailures[outcome],
      )
      if (beforeProving.includes(outcome)) expectNoProvingWork(staged.keys)
      else expect(destroy).toHaveBeenCalledOnce()
      expect(generate).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  )
})
