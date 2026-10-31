import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseOAuthReturn } from '../../oauthReturn.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { buildAuthorizationUrl, returnRules } from './url.js'
import { proofExpiresAt, type TelegramProofV1 } from './validation.js'

const bridge = 'https://bridge.test'
const redirectUri = new URL('/auth/callback', bridge).href
const clientId = '1234567890'
// The ceremony-common §5/§7 vectors (authorization.test.ts), restated by hand.
const digest = Buffer.from(
  '24083f6c849372d1fa0a95615a7b2b6a888edef92e9fa2bebd520b2f536e9350',
  'hex',
)
const nonce = 'JAg_bISTctH6CpVhWnsraoiO3vkun6K-vVILL1Nuk1A'
const codeVerifier = 'rx2URZOjavkbyhw8BXSYLcJRjifbdVFcolqJK7HBVGQ'
const codeChallenge = 'L6b8OlTpVUwPgkYcOYwl-iZdsMj1AN4bN_-DTAPNsX0'

describe('telegram/1 authorization request', () => {
  const input = { clientId, redirectUri, state: 'st', authorizationDigest: digest, codeChallenge }

  it('carries the hand-stated digest vector as the nonce and the S256 challenge', () => {
    expect(createHash('sha256').update(codeVerifier).digest('base64url')).toBe(codeChallenge)
    const params = new URL(buildAuthorizationUrl(input)).searchParams
    expect([params.get('nonce'), params.get('code_challenge')]).toEqual([nonce, codeChallenge])
  })

  it.each([
    ['a 31-byte digest', { authorizationDigest: digest.subarray(1) }],
    ['a 42-character challenge', { codeChallenge: codeChallenge.slice(1) }],
    ['no challenge', { codeChallenge: null }],
  ])('rejects %s', (_name, change) => {
    expect(() => buildAuthorizationUrl({ ...input, ...change })).toThrow()
  })
})

// The other return cases are the catalog-wide conformance suite's.
it('bounds the returned code at 512 bytes', () => {
  const ret = (code: string) =>
    parseOAuthReturn({ query: `?code=${code}&state=st`, fragment: '' }, returnRules)
  expect(ret('c'.repeat(512))).toEqual({
    outcome: 'accepted',
    state: 'st',
    credential: 'c'.repeat(512),
  })
  expect(ret('c'.repeat(513))).toBeNull()
})

describe('telegram/1 code swap through the Bridge', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signal = new AbortController().signal
  const swap = (change = {}) =>
    swapCode({ code: 'abc', codeVerifier, redirectUri, ...change }, signal)

  it('posts the code, verifier and exact redirect URI and returns the ID token', async () => {
    const fetch = vi.fn(async () => Response.json({ id_token: 'h.p.s', token_type: 'Bearer' }))
    vi.stubGlobal('fetch', fetch)
    await expect(swap()).resolves.toBe('h.p.s')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://bridge.test/api/v1/ceremony/telegram/token')
    expect(init).toMatchObject({
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'abc',
      codeVerifier,
      redirectUri: 'https://bridge.test/auth/callback',
    })
  })

  it.each([
    ['an error beside a token', () => Response.json({ error: 'x', id_token: 'h.p.s' })],
    ['no ID token', () => Response.json({ access_token: 'a' })],
    ['an empty ID token', () => Response.json({ id_token: '' })],
    ['a non-string ID token', () => Response.json({ id_token: 1 })],
    ['a body over 64 KiB', () => Response.json({ id_token: 'h'.repeat(64 * 1024) })],
    ['a non-JSON body', () => new Response('<html>')],
  ])('rejects %s', async (_name, answer) => {
    vi.stubGlobal('fetch', async () => answer())
    await expect(swap()).rejects.toThrow()
  })

  it.each([
    ['a code over 512 bytes', { code: 'c'.repeat(513) }],
    [
      'a redirect URI over 512 bytes',
      { redirectUri: `https://${'b'.repeat(60).concat('.').repeat(8)}test/auth/callback` },
    ],
    ['another redirect path', { redirectUri: 'https://bridge.test/callback' }],
    ['a malformed verifier', { codeVerifier: codeVerifier.slice(1) }],
  ])('sends no request with %s', async (_name, change) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(swap(change)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

// Key selection and the request's shape are the OIDC conformance suite's.
describe('telegram/1 signing key through the Bridge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a key set without a key array', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ keys: { kid: 'b' } }))
    await expect(fetchSigningKey(redirectUri, 'b', new AbortController().signal)).rejects.toThrow()
  })

  it('starts no request once aborted', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchSigningKey(redirectUri, 'b', AbortSignal.abort())).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('telegram/1 ID token acceptance', () => {
  const now = 1_800_000_000
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const claims = {
    iss: 'https://oauth.telegram.org',
    aud: clientId,
    sub: 'opaque-subject',
    iat: now - 10,
    exp: now + 3590,
    nonce,
    id: '424242',
    preferred_username: 'synthetic_user',
  }
  function mint(change: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
    const input = `${b64({ alg: 'RS256', kid: 'k1', ...header })}.${b64({ ...claims, ...change })}`
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
  }
  const accept = (token: string) => acceptTelegramIdToken(token, clientId)
  const [h, p, s] = mint().split('.')
  const raw = Buffer.from(JSON.stringify(claims).replace('synthetic', 'X'))
  raw[raw.indexOf('X')] = 0xff

  beforeEach(() => vi.useFakeTimers({ now: now * 1000 }))
  afterEach(() => vi.useRealTimers())

  it.each([
    ['a fresh token', {}],
    ['iat exactly 5 minutes ahead', { iat: now + 300 }],
    ['iat 1 second short of 1 hour old', { iat: now - 3599 }],
  ])('accepts %s', (_name, change) => {
    expect(accept(mint(change))).toMatchObject({
      kid: 'k1',
      claims: { id: '424242', preferred_username: 'synthetic_user' },
    })
  })

  it.each<[string, string]>([
    ['alg none', mint({}, { alg: 'none' })],
    ['no kid', mint({}, { kid: undefined })],
    ['an empty kid', mint({}, { kid: '' })],
    ['an audience array', mint({ aud: [clientId] })],
    ['a 31-byte nonce', mint({ nonce: nonce.slice(0, 42) })],
    ['no nonce', mint({ nonce: undefined })],
    ['a canonical 31-byte nonce', mint({ nonce: digest.subarray(1).toString('base64url') })],
    [
      'a 33-byte nonce',
      mint({ nonce: Buffer.concat([digest, digest]).subarray(0, 33).toString('base64url') }),
    ],
    ['iat exactly 1 hour old', mint({ iat: now - 3600 })],
    ['iat over 1 hour old', mint({ iat: now - 3601 })],
    ['no iat', mint({ iat: undefined })],
    ['a numeric id', mint({ id: 424242 })],
    ['a non-decimal id', mint({ id: '42a' })],
    ['a signed id', mint({ id: '-1' })],
    ['an empty id', mint({ id: '' })],
    ['no id', mint({ id: undefined })],
    ['two segments', mint().split('.').slice(0, 2).join('.')],
    ['an empty signature', `${mint().split('.').slice(0, 2).join('.')}.`],
    ['a non-base64url signature', `${h}.${p}.${s.slice(1)}+`],
    ['a non-UTF-8 payload', `${h}.${raw.toString('base64url')}.${s}`],
    ['a non-JSON payload', `${b64({ alg: 'RS256', kid: 'k1' })}.bm90IGpzb24.c2ln`],
  ])('rejects %s', (_name, token) => {
    expect(() => accept(token)).toThrow(expect.objectContaining({ event: 'authorization' }))
  })

  it.each([[''], [undefined]])('asks for a username when preferred_username is %j', (name) => {
    expect(() => accept(mint({ preferred_username: name }))).toThrow('Set a Telegram username')
  })
})

it('refuses a proof expiry past the safe integer range', () => {
  const at = (tokenIssuedAt: number) => () => proofExpiresAt({ tokenIssuedAt } as TelegramProofV1)
  expect(at(Number.MAX_SAFE_INTEGER - 3600)()).toBe(Number.MAX_SAFE_INTEGER)
  expect(at(Number.MAX_SAFE_INTEGER - 3599)).toThrow('Proof expiry exceeds safe integer range')
})
