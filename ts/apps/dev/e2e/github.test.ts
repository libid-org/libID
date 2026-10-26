// The TOTP code against an RFC 6238 vector (SHA-1, 30 s, 6 digits) computed with Python's hmac.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { totp } from './github.ts'

test('the TOTP code matches the reference vector, spaces and case aside', () => {
  assert.equal(totp('JBSWY3DPEHPK3PXP', 1_700_000_000_000), '324550')
  assert.equal(totp('jbsw y3dp ehpk 3pxp', 1_700_000_000_000), '324550')
})
