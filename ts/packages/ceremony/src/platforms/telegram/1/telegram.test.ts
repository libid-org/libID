import { afterEach, expect, it, vi } from 'vitest'
import { REQUEST_TIMEOUT_MS } from '../../../response.js'
import { jwtPart, telegramV1 } from '../../conformance/fixtures.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { proofExpiresAt, type TelegramProofV1 } from './validation.js'

const redirectUri = 'https://bridge.test/auth/callback'
const live = new AbortController().signal
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

it('fetches no key once aborted', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(fetchSigningKey(redirectUri, 'b', AbortSignal.abort())).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('refuses a key set without a key array', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ keys: { kid: 'b' } }))
  await expect(fetchSigningKey(redirectUri, 'b', new AbortController().signal)).rejects.toThrow(
    'Invalid key set',
  )
})

it.each([
  [
    'swap',
    () => swapCode({ code: 'abc', codeVerifier: 'A'.repeat(43), redirectUri }, live),
    'The Bridge did not answer the token request in time',
  ],
  ['key fetch', () => fetchSigningKey(redirectUri, 'b', live), 'Signing key request timed out'],
])('gives up on a silent Bridge %s after 15 s', async (_name, call, message) => {
  vi.useFakeTimers()
  // Node's AbortSignal.timeout ignores fake timers; this one runs on them.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const timeout = new AbortController()
    setTimeout(() => timeout.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    return timeout.signal
  })
  vi.stubGlobal(
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      ),
  )
  let settled = false
  const pending = call().finally(() => {
    settled = true
  })
  pending.catch(() => {})
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await expect(pending).rejects.toThrow(message)
})

it('refuses a proof expiry past the safe integer range', () => {
  const at = (tokenIssuedAt: number) => () => proofExpiresAt({ tokenIssuedAt } as TelegramProofV1)
  expect(at(Number.MAX_SAFE_INTEGER - 3600)()).toBe(Number.MAX_SAFE_INTEGER)
  expect(at(Number.MAX_SAFE_INTEGER - 3599)).toThrow('Proof expiry exceeds safe integer range')
})
