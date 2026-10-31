import { afterEach, expect, it, vi } from 'vitest'
import { jwtPart, telegramV1 } from '../../conformance/fixtures.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { proofExpiresAt, type TelegramProofV1 } from './validation.js'

const redirectUri = 'https://bridge.test/auth/callback'
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each([
  [300, true],
  [301, false],
  [-3599, true],
  [-3600, false],
])('takes a token issued %is from now: %s', (ahead, accepted) => {
  const { iat, aud } = jwtPart(telegramV1.idToken, 1) as { iat: number; aud: string }
  vi.useFakeTimers({ now: (iat - ahead) * 1000 })
  const accept = () => acceptTelegramIdToken(telegramV1.idToken, aud)
  if (accepted) expect(accept().claims.iat).toBe(iat)
  else expect(accept).toThrow(expect.objectContaining({ event: 'authorization' }))
})

it.each([
  ['another redirect path', { redirectUri: 'https://bridge.test/callback' }],
  ['a malformed verifier', { codeVerifier: 'A'.repeat(42) }],
])('sends no swap with %s', async (_name, change) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const input = { code: 'abc', codeVerifier: 'A'.repeat(43), redirectUri, ...change }
  await expect(swapCode(input, new AbortController().signal)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('refuses a key set without a key array, and fetches no key once aborted', async () => {
  const fetch = vi.fn(async () => Response.json({ keys: { kid: 'b' } }))
  vi.stubGlobal('fetch', fetch)
  await expect(fetchSigningKey(redirectUri, 'b', AbortSignal.abort())).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
  await expect(fetchSigningKey(redirectUri, 'b', new AbortController().signal)).rejects.toThrow()
})

it('refuses a proof expiry past the safe integer range', () => {
  const at = (tokenIssuedAt: number) => () => proofExpiresAt({ tokenIssuedAt } as TelegramProofV1)
  expect(at(Number.MAX_SAFE_INTEGER - 3600)()).toBe(Number.MAX_SAFE_INTEGER)
  expect(at(Number.MAX_SAFE_INTEGER - 3599)).toThrow('Proof expiry exceeds safe integer range')
})
