import { afterEach, expect, it, vi } from 'vitest'
import type { ProverContext } from '../../context.js'
import { prove as proveX } from './prover.js'

const { pipeline } = vi.hoisted(() => ({ pipeline: vi.fn() }))
vi.mock('../../bearer-link/prover.js', () => ({ proveBearerLink: pipeline }))
afterEach(() => vi.resetAllMocks())

it('requires codeVerifier before notarization [LIBID-OAUTH-021]', async () => {
  const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  const context: ProverContext = {
    ceremonyId,
    signal: new AbortController().signal,
    emit: vi.fn(),
    request: {
      type: 'prove-identity',
      platformId: 'x',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: 'https://bridge.test/callback',
      codeVerifier: null,
      notaryAddress: 'https://notary.test',
    },
    oauthReturn: { query: `?code=fixture&state=v1.${ceremonyId}`, fragment: '' },
  }
  await expect(proveX(context)).rejects.toBeInstanceOf(Error)
  expect(pipeline).not.toHaveBeenCalled()
})
