import { afterEach, expect, it, vi } from 'vitest'
import type { ProverContext } from '../../context.js'
import { prove as proveGitHub } from './prover.js'

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
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      clientCredential: 'public-fixture',
      redirectUri: 'https://bridge.test/callback',
      codeVerifier: null,
      notaryAddress: 'https://notary.test',
    },
    oauthReturn: {
      query: `?code=fixture&state=v1.${ceremonyId}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
      fragment: '',
    },
  }
  await expect(proveGitHub(context)).rejects.toBeInstanceOf(Error)
  expect(pipeline).not.toHaveBeenCalled()
})

it.each([
  ['denial', '?error=access_denied', null],
  ['wrong issuer', '?code=fixture&iss=https://other.test', 'authorization'],
  ['missing credential', '?code=fixture', 'token-fetch'],
] as const)('handles %s before any exchange', async (name, query, event) => {
  const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  const context: ProverContext = {
    ceremonyId,
    signal: new AbortController().signal,
    emit: vi.fn(),
    request: {
      type: 'prove-identity',
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: 'https://bridge.test/auth/callback',
      codeVerifier: 'a'.repeat(43),
      notaryAddress: 'https://notary.test',
      ...(name === 'missing credential' ? {} : { clientCredential: 'public-fixture' }),
    },
    oauthReturn: {
      fragment: '',
      query: `${query}&state=v1.${ceremonyId}${name === 'wrong issuer' ? '' : '&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth'}`,
    },
  }
  if (event === null) await expect(proveGitHub(context)).resolves.toBeNull()
  else await expect(proveGitHub(context)).rejects.toMatchObject({ event })
  expect(pipeline).not.toHaveBeenCalled()
})
