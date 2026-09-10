import { afterEach, expect, it, vi } from 'vitest'
import type { ProverContext } from '../../../prover/context.js'
import { prove } from './prover.js'

const { admit } = vi.hoisted(() => ({ admit: vi.fn() }))
vi.mock('virtual:ceremony-assets', () => ({ urls: {} }))
vi.mock('../../../assets.js', async (original) => ({
  ...(await original<typeof import('../../../assets.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))
vi.mock('../../../prover/engine.js', () => ({
  PROOF_ENGINE_SPANS: [],
  ProofEngine: class {
    destroy() {}
  },
}))
vi.mock('./token.js', () => ({
  encodeTokenRequest: () => new Uint8Array(),
  decodeTokenResponse: () => ({}),
  admitTokenResponse: admit,
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
function context(outcome: Record<string, string>): ProverContext {
  const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  return {
    ceremonyId,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    onStage: vi.fn(),
    request: {
      type: 'app-start-prover',
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      codeVerifier: 'a'.repeat(43),
      redirectUri: 'https://bridge.test/callback',
      notaryAddress: 'https://notary.test',
    },
    oauthReturn: {
      fragment: '',
      query:
        '?' +
        new URLSearchParams({
          state: `v1.${ceremonyId}`,
          iss: 'https://github.com/login/oauth',
          ...outcome,
        }),
    },
  }
}
it('returns detailed GitHub denial before any token exchange', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const input = context({ error: 'access_denied', error_description: 'Denied', error_uri: '/help' })
  await expect(prove(input)).resolves.toBeNull()
  expect(input.onStage).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects a mismatched issuer before token exchange', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(prove(context({ code: 'test', iss: 'https://other.test' }))).rejects.toMatchObject({
    code: 'oauth-return',
  })
  expect(fetch).not.toHaveBeenCalled()
})
it('classifies token admission failure and retains its local cause', async () => {
  const cause = new Error('synthetic private admission detail')
  admit.mockImplementation(() => {
    throw cause
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })),
  )
  const input = context({ code: 'test' })
  await expect(prove(input)).rejects.toMatchObject({
    code: 'token-exchange',
    cause,
  })
  expect(input.onStage).toHaveBeenCalledExactlyOnceWith('code-exchange')
})
