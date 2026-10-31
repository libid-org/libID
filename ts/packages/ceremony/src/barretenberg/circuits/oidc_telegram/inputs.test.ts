import { createSign, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptTelegramIdToken } from '../../../platforms/telegram/1/token.js'
import { buildOidcTelegramInputs } from './inputs.js'
import { MAX_SIGNING_INPUT_BYTES, PUBLIC_INPUT_COUNT } from './parameters.js'

// Vectors from libid-circuits' scripts/telegram-fixture-witness.py (hashlib, not this builder),
// copied into vectors/ at the libid-circuits commit each file's first line names.
const vectors = new URL('./vectors/', import.meta.url)

// `fn main` of circuits/oidc-telegram/src/main.nr, in order.
const ABI_KEYS = [
  ...['signing_input', 'signing_input_len', 'header_b64_len'],
  ...['iss_window', 'iss_offset', 'aud_window', 'aud_offset', 'audience_len'],
  ...['iat_window', 'iat_offset', 'iat_len', 'id_window', 'id_offset', 'id_len'],
  ...['username_window', 'username_offset', 'username_len', 'nonce_window', 'nonce_offset'],
  ...['signature', 'redc', 'authorization_digest', 'audience_hash', 'id_node', 'handle_node'],
  ...['iat', 'modulus'],
]

const recompose = (limbs: unknown[]) =>
  limbs.reduce<bigint>((value, limb, i) => value | (BigInt(String(limb)) << (120n * BigInt(i))), 0n)
const bytesOf = (value: bigint, length: number) =>
  Uint8Array.from(Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex'))
/** One spelling for numbers, decimal strings and 0x fields, so only values are compared. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical) : BigInt(String(value))

// Every vector and synthetic token is issued at this time to client 7000000001.
const iat = 1893452400
const clientId = '7000000001'
beforeEach(() => vi.useFakeTimers({ now: iat * 1000 }))
afterEach(() => vi.useRealTimers())

/** The production parse of `idToken`, then the circuit inputs. */
const inputsOf = (idToken: string, modulus: Uint8Array, client = clientId) =>
  buildOidcTelegramInputs(acceptTelegramIdToken(idToken, client), modulus)

describe('oidc_telegram circuit inputs', () => {
  it.each(['Prover.toml', 'Prover-max.toml', 'Prover-reordered.toml'])(
    'rebuilds %s field by field from the token it was signed for',
    (file) => {
      const toml = parse(readFileSync(new URL(file, vectors), 'utf8')) as Record<string, unknown[]>
      const signingInput = Buffer.from(
        (toml.signing_input as number[]).slice(0, Number(toml.signing_input_len)),
      ).toString()
      const signature = bytesOf(recompose(toml.signature), 256)
      const idToken = `${signingInput}.${Buffer.from(signature).toString('base64url')}`
      const modulus = bytesOf(recompose(toml.modulus), 256)

      const inputs = inputsOf(idToken, modulus)
      expect(Object.keys(inputs)).toEqual(ABI_KEYS)
      expect(Object.keys(toml).sort()).toEqual([...ABI_KEYS].sort())
      for (const key of ABI_KEYS)
        expect(canonical(inputs[key as keyof typeof inputs]), key).toEqual(canonical(toml[key]))
    },
  )

  it('fixes the signing-input buffer and the public input count', () => {
    expect(MAX_SIGNING_INPUT_BYTES).toBe(2688)
    // Digest bytes, audience hash, id node, handle node, iat and 18 modulus limbs.
    expect(PUBLIC_INPUT_COUNT).toBe(32 + 2 + 2 + 2 + 1 + 18)
  })
})

describe('oidc_telegram circuit input refusals', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const modulus = Uint8Array.from(
    Buffer.from(publicKey.export({ format: 'jwk' }).n as string, 'base64url'),
  )
  const digest = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1)
  const nonce = Buffer.from(digest).toString('base64url')
  const escaped = (length: number) => '\\u00e9'.repeat(length)

  /** A Telegram-shaped RS256 token over `claims`, slashes escaped as Telegram sends them. */
  function sign(claims: Record<string, unknown>, extra = ''): string {
    const part = (json: string) => Buffer.from(json).toString('base64url')
    const header = part('{"alg":"RS256","kid":"oidc-1","typ":"JWT"}')
    const body = `${JSON.stringify(claims).replaceAll('/', '\\/').slice(0, -1)}${extra}}`
    const input = `${header}.${part(body)}`
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey)
    return `${input}.${signature.toString('base64url')}`
  }
  const claims = (change: Record<string, unknown> = {}) => ({
    aud: clientId,
    iat,
    iss: 'https://oauth.telegram.org',
    preferred_username: 'Brynn_QX',
    id: '7051836294',
    nonce,
    ...change,
  })
  const build = (token: string, client?: string) => () => inputsOf(token, modulus, client)

  it('builds a worst-case token: escaped 64-char names, 32-byte username, 20-digit id', () => {
    const extra = `,"name":"${escaped(64)}","given_name":"${escaped(64)}"`
    const token = sign(claims({ preferred_username: 'A'.repeat(32), id: '9'.repeat(20) }), extra)
    const inputs = inputsOf(token, modulus)
    expect(inputs.username_len).toBe('32')
    expect(inputs.id_len).toBe('20')
    expect(Number(inputs.signing_input_len)).toBeLessThanOrEqual(MAX_SIGNING_INPUT_BYTES)
    expect(inputs.signing_input).toHaveLength(MAX_SIGNING_INPUT_BYTES)
  })

  it.each([
    ['a signing input past 2688 bytes', sign(claims(), `,"name":"${escaped(400)}"`)],
    ['no preferred_username', sign(claims({ preferred_username: undefined }))],
    ['a 33-byte username', sign(claims({ preferred_username: 'a'.repeat(33) }))],
    ['a username with a quote', sign(claims({ preferred_username: 'al"ice' }))],
    ['a username with a backslash', sign(claims({ preferred_username: 'al\\ice' }))],
    ['a 21-digit id', sign(claims({ id: '1'.repeat(21) }))],
    ['a non-numeric id', sign(claims({ id: '50000x0001' }))],
    ['a 42-char nonce', sign(claims({ nonce: nonce.slice(0, 42) }))],
    ['a padded nonce', sign(claims({ nonce: `${nonce}=` }))],
  ])('refuses %s', (_, token) => {
    expect(build(token)).toThrow()
  })

  it.each([
    ['a 21-byte aud', '7'.repeat(21)],
    ['an empty aud', ''],
  ])('refuses %s its client accepted', (_, aud) => {
    expect(build(sign(claims({ aud })), aud)).toThrow('Telegram ID token: bad aud')
  })

  it('refuses a 31-byte digest even when the nonce encodes it', () => {
    const short = digest.subarray(1)
    expect(build(sign(claims({ nonce: Buffer.from(short).toString('base64url') })))).toThrow()
  })
})
