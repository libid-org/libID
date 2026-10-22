// The TOTP code against the reference vector the Rust suite checks (github.rs).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { totp } from './github.ts'

test('the TOTP code matches the reference vector, spaces and case aside', () => {
  assert.equal(totp('JBSWY3DPEHPK3PXP', 1_700_000_000_000), '324550')
  assert.equal(totp('jbsw y3dp ehpk 3pxp', 1_700_000_000_000), '324550')
})

test('a key that is not base32 names its setting, not its value', () => {
  assert.throws(
    () => totp('not-base32!'),
    (error: Error) => {
      assert.equal(error.message, 'GH_TEST_ALICE_TOTP_SECRET is not a base32 key')
      return true
    },
  )
})
