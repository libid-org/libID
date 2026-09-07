import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveNotaryAddresses } from './assets.ts'
import { responseHeaders } from './profiles.ts'
test('notary mapping and exact CSP share production/testnet or one development override [LIBID-ASSET-003] [CSP-011]', () => {
  const defaults = resolveNotaryAddresses()
  assert.deepEqual(defaults, ['https://notary.lib.id', 'https://testnet.notary.lib.id'])
  for (const override of [undefined, 'https://local-notary.test']) {
    const notaryAddresses = resolveNotaryAddresses(override)
    if (override) assert.deepEqual(notaryAddresses, [override, override])
    for (const profile of ['prover', 'proverFallback', 'executionWorker'] as const) {
      const policy = responseHeaders(profile, { notaryAddresses })['Content-Security-Policy']
      assert.deepEqual(
        policy.match(/wss:\/\/[^ ;]+/g),
        override
          ? ['wss://local-notary.test']
          : ['wss://notary.lib.id', 'wss://testnet.notary.lib.id'],
      )
    }
  }
  for (const override of [
    '',
    'http://localhost',
    'https://notary.test/',
    'https://notary.test/path',
    'https://user@notary.test',
    'https://notary.test?x=1',
  ])
    assert.throws(() => resolveNotaryAddresses(override))
})
