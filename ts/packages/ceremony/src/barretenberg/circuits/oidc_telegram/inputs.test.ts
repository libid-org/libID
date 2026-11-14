import { readFileSync } from 'node:fs'
import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { parse } from 'smol-toml'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { identityNodes } from '../../../identity.js'
import { jwtPart, jwtWith, telegramV1 } from '../../../platforms/conformance/fixtures.js'
import { acceptTelegramIdToken } from '../../../platforms/telegram/1/token.js'
import { b64urlDecode } from '../../../primitives.js'
import { buildOidcTelegramInputs } from './inputs.js'

// From libid-circuits scripts/telegram-fixture-witness.py; `fn main` order of oidc-telegram.
const vectors = new URL('./vectors/', import.meta.url)
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
const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical) : BigInt(String(value))

const { iat, aud } = jwtPart(telegramV1.idToken, 1) as { iat: number; aud: string }
beforeEach(() => vi.useFakeTimers({ now: iat * 1000 }))
afterEach(() => vi.useRealTimers())

// A payload sized so the signing input is 2689 bytes, one past the circuit's buffer.
const header = telegramV1.idToken.indexOf('.')
const fill =
  ((2688 - header) * 3) / 4 - JSON.stringify({ ...jwtPart(telegramV1.idToken, 1), name: '' }).length

function inputsOf(idToken: string, modulus: Uint8Array, client = aud) {
  const token = acceptTelegramIdToken(idToken, client)
  const { id: userId, preferred_username: userName } = token.claims
  const nodes = identityNodes({ platformId: PLATFORM_TELEGRAM_KEY, userId, userName })
  return buildOidcTelegramInputs(token, modulus, nodes)
}

it.each(['Prover.toml', 'Prover-max.toml', 'Prover-reordered.toml'])(
  'rebuilds %s field by field from the token it was signed for',
  (file) => {
    const toml = parse(readFileSync(new URL(file, vectors), 'utf8')) as Record<string, unknown[]>
    const signingInput = Buffer.from(
      (toml.signing_input as number[]).slice(0, Number(toml.signing_input_len)),
    ).toString()
    const signature = bytesOf(recompose(toml.signature), 256)
    const idToken = `${signingInput}.${Buffer.from(signature).toString('base64url')}`
    const inputs = inputsOf(idToken, bytesOf(recompose(toml.modulus), 256))
    expect(Object.keys(inputs)).toEqual(ABI_KEYS)
    expect(Object.keys(toml).sort()).toEqual([...ABI_KEYS].sort())
    for (const key of ABI_KEYS)
      expect(canonical(inputs[key as keyof typeof inputs]), key).toEqual(canonical(toml[key]))
  },
)

it.each([
  ['a 2689-byte signing input', { name: 'x'.repeat(fill) }, aud],
  ['a 21-byte aud', { aud: '7'.repeat(21) }, '7'.repeat(21)],
  ['an empty aud', { aud: '' }, ''],
])('refuses %s', (_name, change, client) => {
  const payload = { ...jwtPart(telegramV1.idToken, 1), ...change }
  const token = jwtWith(telegramV1.idToken, { payload })
  expect(() => inputsOf(token, b64urlDecode(telegramV1.jwk.n)!, client)).toThrow(
    /^Telegram ID token: /,
  )
})
