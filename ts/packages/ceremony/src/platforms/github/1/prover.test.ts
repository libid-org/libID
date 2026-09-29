import { afterEach, describe, expect, it, vi } from 'vitest'
import { CEREMONY_ID } from '../../../testing/index.js'
import type { ProverContext } from '../../context.js'
import { prove as proveGitHub } from './prover.js'

const { pipeline } = vi.hoisted(() => ({ pipeline: vi.fn() }))
vi.mock('../../bearer.js', () => ({ proveBearerLink: pipeline }))
afterEach(() => vi.resetAllMocks())

const ceremonyId = CEREMONY_ID
const issuer = 'https://github.com/login/oauth'

function context(query: string): ProverContext {
  return {
    ceremonyId,
    signal: new AbortController().signal,
    emit: vi.fn(),
    request: {
      type: 'prove-identity',
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      clientCredential: 'public-fixture',
      redirectUri: 'https://bridge.test/auth/callback',
      codeVerifier: 'a'.repeat(43),
      notaryAddress: 'https://notary.test',
    },
    oauthReturn: { query, fragment: '' },
  }
}

it('requires codeVerifier before notarization [LIBID-OAUTH-021]', async () => {
  const input = context(`?code=fixture&state=v1.${ceremonyId}&iss=${issuer}`)
  input.request.codeVerifier = null
  await expect(proveGitHub(input)).rejects.toMatchObject({ event: 'authorization' })
  expect(pipeline).not.toHaveBeenCalled()
})

it('requires the public credential before exchange', async () => {
  const input = context(`?code=fixture&state=v1.${ceremonyId}&iss=${issuer}`)
  delete input.request.clientCredential
  await expect(proveGitHub(input)).rejects.toMatchObject({ event: 'token-fetch' })
  expect(pipeline).not.toHaveBeenCalled()
})

describe.each(['code=fixture', 'error=access_denied', 'error=server_error'])(
  'GitHub issuer for %s [LIBID-OAUTH-031] [TEST-PLAT-12A]',
  (outcome) => {
    const query = `?${outcome}&state=v1.${ceremonyId}`
    it.each([issuer, encodeURIComponent(issuer)])('accepts exact issuer %s', async (iss) => {
      const identity = { userId: '123', userName: 'alice' }
      pipeline.mockResolvedValue({ identity, proof: {} })
      const pending = proveGitHub(context(`${query}&iss=${iss}`))
      if (outcome === 'code=fixture') {
        await expect(pending).resolves.toMatchObject({ identity })
        expect(pipeline).toHaveBeenCalledOnce()
      } else {
        if (outcome === 'error=access_denied') await expect(pending).resolves.toBeNull()
        else await expect(pending).rejects.toMatchObject({ event: 'authorization' })
        expect(pipeline).not.toHaveBeenCalled()
      }
    })
    it.each([
      '',
      `&iss=${issuer}&iss=${issuer}`,
      '&iss=%ZZ',
      '&iss=%FF',
      `&iss=${encodeURIComponent(encodeURIComponent(issuer))}`,
      '&iss=https://other.test',
      '&iss=https://GitHub.com/login/oauth',
      '&iss=https://github.com:443/login/oauth',
      `&iss=${issuer}/`,
    ])('rejects invalid issuer %j before exchange or denial', async (suffix) => {
      await expect(proveGitHub(context(query + suffix))).rejects.toMatchObject({
        event: 'authorization',
      })
      expect(pipeline).not.toHaveBeenCalled()
    })
    it('rejects a mismatched state despite a valid issuer', async () => {
      const input = context(`?${outcome}&state=v1.other&iss=${issuer}`)
      await expect(proveGitHub(input)).rejects.toMatchObject({ event: 'authorization' })
      expect(pipeline).not.toHaveBeenCalled()
    })
  },
)
