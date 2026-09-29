import { afterEach, expect, it, vi } from 'vitest'
import { fetchSigningKey } from './token.js'

afterEach(() => vi.unstubAllGlobals())

const keySet = (keys: unknown[]) =>
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys })))

it('selects exactly the signing key published for the token kid', async () => {
  const key = { kid: 'current', kty: 'RSA', e: 'AQAB', n: 'modulus' }
  keySet([{ kid: 'previous' }, key])
  await expect(fetchSigningKey('current', new AbortController().signal)).resolves.toEqual(key)
  for (const keys of [[{ kid: 'previous' }], [key, key], []]) {
    keySet(keys)
    await expect(fetchSigningKey('current', new AbortController().signal)).rejects.toThrow(
      'Signing key is not unique',
    )
  }
})
