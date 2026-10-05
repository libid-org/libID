import { describe, expect, it, vi } from 'vitest'
import { fixtures } from '../../testing/index.js'
import { AUTHORIZATION_NONCE_BYTES } from '../authorization.js'
import { assembleResult, supportedPlatforms } from '../index.js'
import { destroy, generate } from './mocks.js'
import {
  type EngineInputChange,
  engineInputChanges,
  expectEngineAssets,
  phases,
  proverKinds,
  proverOf,
  type SharedOutcome,
  tagged,
} from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

describe.each(supportedPlatforms)('%s prove() contract', (platformId) => {
  const fixture = fixtures[platformId]
  const { stage, tags } = proverKinds[fixture.proverKind]
  const sessionReported: readonly string[] = proverKinds[fixture.proverKind].sessionReported
  const title = (text: string) => tagged(text, `${tags} ${fixture.specTests.prover}`)
  async function run(outcome: SharedOutcome) {
    const staged = stage(platformId, outcome)
    return { staged, pending: (await proverOf(platformId)).prove(staged.context) }
  }

  it(
    title(
      'delivers the shared identity beside its proof through structured clone and client assembly',
    ),
    async () => {
      const { staged, pending } = await run('accepted')
      const result = await pending
      // Shared identity beside the platform proof; no nested identity or flattened inputs.
      expect(result).toEqual({ identity: fixture.identity, proof: staged.proof() })
      const delivery = structuredClone({ type: 'identity-proof' as const, ...result! })
      expect(
        assembleResult(
          platformId,
          1,
          delivery,
          fixture.config.clientId,
          new Uint8Array(AUTHORIZATION_NONCE_BYTES),
          fixture.digest,
        ),
      ).toMatchObject({ status: 'accepted', identity: fixture.identity })
      expectEngineAssets(platformId)
    },
  )

  it(title('reports each prover operation once, started before finished'), async () => {
    const { staged, pending } = await run('accepted')
    await pending
    const reported = fixture.operations.filter((name) => !sessionReported.includes(name))
    for (const operation of [...reported, 'circuit-inputs'])
      expect(phases(staged.events, operation), operation).toEqual(['started', 'finished'])
  })

  it(
    title('proves once under a signal that aborts with the run, and destroys its engine'),
    async () => {
      const staged = stage(platformId, 'accepted')
      const prove = generate.getMockImplementation()!
      const aborted: boolean[] = []
      generate.mockImplementation(async (inputs, signal) => {
        aborted.push(signal!.aborted)
        staged.abort(new Error('Closed while proving'))
        aborted.push(signal!.aborted)
        return prove(inputs, signal)
      })
      // Whether a result still settles is the document's concern; it discards late results.
      await Promise.allSettled([(await proverOf(platformId)).prove(staged.context)])
      expect(aborted).toEqual([false, true])
      expect(generate).toHaveBeenCalledOnce()
      expect(destroy).toHaveBeenCalledOnce()
    },
  )

  it.each(Object.entries(engineInputChanges) as [EngineInputChange, string][])(
    title('rejects engine public inputs %s and destroys its engine'),
    async (change) => {
      const { pending } = await run(change)
      await expect(pending).rejects.toThrow('public input mismatch')
      expect(destroy).toHaveBeenCalledOnce()
    },
  )

  it(title('stops at startup cancellation before network, notary or proving work'), async () => {
    const { staged, pending } = await run('startup-cancel')
    await expect(pending).rejects.toThrow('Closed during startup')
    staged.untouched()
    expect(generate).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
