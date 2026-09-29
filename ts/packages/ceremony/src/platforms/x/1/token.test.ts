import { expect, it } from 'vitest'
import { buildTokenRequest } from './transcript.js'

const input = {
  clientId: 'client',
  code: 'x-code',
  redirectUri: 'https://bridge.test/auth/callback',
  codeVerifier: 'A'.repeat(43),
}

it.each([
  { clientId: '' },
  { clientId: 'a+b' },
  { code: '' },
  { code: 'has space' },
  { code: 'x'.repeat(1025) },
  { redirectUri: 'https://bridge.test/callback?next=1' },
  { codeVerifier: 'a'.repeat(43) },
])('rejects the token inputs GitHub also rejects: %j', (change) => {
  expect(() => buildTokenRequest(input)).not.toThrow()
  expect(() => buildTokenRequest({ ...input, ...change })).toThrow('Invalid token request')
})
