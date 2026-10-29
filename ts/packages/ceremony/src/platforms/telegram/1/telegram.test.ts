import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseOAuthReturn } from '../../oauthReturn.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { buildAuthorizationUrl, pkce, returnRules } from './url.js'

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

  it('carries the digest as the nonce and the S256 challenge, in the spec order', () => {
    expect(pkce).toBe(true)
    expect(createHash('sha256').update(codeVerifier).digest('base64url')).toBe(codeChallenge)
    const url = new URL(buildAuthorizationUrl(input))
    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.telegram.org/auth')
    expect(url.hash).toBe('')
    expect(url.search.slice(1)).toBe(
      new URLSearchParams([
        ['response_type', 'code'],
        ['client_id', clientId],
        ['redirect_uri', 'https://bridge.test/auth/callback'],
        ['scope', 'openid profile'],
        ['state', 'st'],
        ['nonce', nonce],
        ['code_challenge', codeChallenge],
        ['code_challenge_method', 'S256'],
      ]).toString(),
    )
  })

  it.each([
    ['a 31-byte digest', { authorizationDigest: digest.subarray(1) }],
    ['a 42-character challenge', { codeChallenge: codeChallenge.slice(1) }],
    ['no challenge', { codeChallenge: null }],
  ])('rejects %s', (_name, change) => {
    expect(() => buildAuthorizationUrl({ ...input, ...change })).toThrow()
  })
})

describe('telegram/1 return', () => {
  const ret = (query: string, fragment = '') => parseOAuthReturn({ query, fragment }, returnRules)

  it.each([
    ['?code=abc&state=st', '', { outcome: 'accepted', state: 'st', credential: 'abc' }],
    ['?error=access_denied&state=st', '', { outcome: 'denied', state: 'st' }],
    ['?error=server_error&state=st', '', { outcome: 'error', state: 'st', error: 'server_error' }],
    ['', '#code=abc&state=st', null],
    ['?code=abc&state=st', '#x', null],
    ['?code=abc&error=access_denied&state=st', '', null],
    ['?code=abc&code=abd&state=st', '', null],
    ['?code=abc&id_token=x.y.z&state=st', '', null],
    ['?code=abc', '', null],
  ])('reads %s%s', (query, fragment, expected) => {
    expect(ret(query, fragment)).toEqual(expected)
  })
})

describe('telegram/1 code swap through the Bridge', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signal = new AbortController().signal
  const swap = () => swapCode(bridge, { code: 'abc', codeVerifier, redirectUri }, signal)

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
    ['an error answered with 200', () => Response.json({ error: 'invalid_grant' })],
    ['an error beside a token', () => Response.json({ error: 'x', id_token: 'h.p.s' })],
    ['no ID token', () => Response.json({ access_token: 'a' })],
    ['an empty ID token', () => Response.json({ id_token: '' })],
    ['a non-string ID token', () => Response.json({ id_token: 1 })],
    ['a body over 64 KiB', () => Response.json({ id_token: 'h'.repeat(64 * 1024) })],
    ['a non-JSON body', () => new Response('<html>')],
    ['an HTTP failure', () => Response.json({ id_token: 'h.p.s' }, { status: 500 })],
  ])('rejects %s', async (_name, answer) => {
    vi.stubGlobal('fetch', async () => answer())
    await expect(swap()).rejects.toThrow()
  })
})

describe('telegram/1 signing key through the Bridge', () => {
  afterEach(() => vi.unstubAllGlobals())
  const key = (kid: string) => ({ kty: 'RSA', kid, n: 'AQAB', e: 'AQAB' })

  it('fetches the Bridge key set without credentials or redirects and picks the kid', async () => {
    const fetch = vi.fn(async () => Response.json({ keys: [key('a'), key('b')] }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchSigningKey(bridge, 'b', new AbortController().signal)).resolves.toEqual(
      key('b'),
    )
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://bridge.test/api/v1/ceremony/telegram/jwks')
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' })
  })

  it.each([
    ['no key with the kid', { keys: [key('a')] }],
    ['two keys with the kid', { keys: [key('b'), key('b')] }],
    ['no key array', { keys: key('b') }],
  ])('rejects %s', async (_name, body) => {
    vi.stubGlobal('fetch', async () => Response.json(body))
    await expect(fetchSigningKey(bridge, 'b', new AbortController().signal)).rejects.toThrow()
  })

  it('starts no request once aborted', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchSigningKey(bridge, 'b', AbortSignal.abort())).rejects.toThrow()
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
  const accept = (token: string) => acceptTelegramIdToken(token, clientId, digest)
  const [h, p, s] = mint().split('.')
  const raw = Buffer.from(JSON.stringify(claims).replace('synthetic', 'X'))
  raw[raw.indexOf('X')] = 0xff

  beforeEach(() => vi.useFakeTimers({ now: now * 1000 }))
  afterEach(() => vi.useRealTimers())

  it.each([
    ['a fresh token', {}],
    ['iat exactly 5 minutes ahead', { iat: now + 300 }],
    ['iat exactly 1 hour old', { iat: now - 3600 }],
  ])('accepts %s', (_name, change) => {
    expect(accept(mint(change))).toMatchObject({
      kid: 'k1',
      claims: { id: '424242', preferred_username: 'synthetic_user' },
    })
  })

  it.each<[string, string]>([
    ['alg HS256', mint({}, { alg: 'HS256' })],
    ['alg none', mint({}, { alg: 'none' })],
    ['no kid', mint({}, { kid: undefined })],
    ['an empty kid', mint({}, { kid: '' })],
    ['another issuer', mint({ iss: 'https://oauth.telegram.org/' })],
    ['another audience', mint({ aud: '1234567891' })],
    ['an audience array', mint({ aud: [clientId] })],
    ["another session's nonce", mint({ nonce: `B${nonce.slice(1)}` })],
    ['no nonce', mint({ nonce: undefined })],
    ['iat over 5 minutes ahead', mint({ iat: now + 301 })],
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

  it('refuses an account without a username and tells the user to set one', () => {
    expect(() => accept(mint({ preferred_username: undefined }))).toThrow(
      expect.objectContaining({
        event: 'authorization',
        message: expect.stringMatching(/username/i),
      }),
    )
  })
})
