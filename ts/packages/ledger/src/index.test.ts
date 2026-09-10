import { expect, it } from 'vitest'
import { mainnet, testnet } from './testing.js'
it('synthetic ledgers return independent hashes and support local notary routing', () => {
  for (const ledger of [mainnet, testnet]) {
    const expected = ledger.hash()
    expect(expected).toHaveLength(32)
    ledger.hash().fill(9)
    expect(ledger.hash()).toEqual(expected)
    const local = { ...ledger, notaryAddress: () => 'https://localhost:4687' }
    expect(local.hash()).toEqual(expected)
    expect(local.notaryAddress()).toBe('https://localhost:4687')
  }
  expect(mainnet.hash()).not.toEqual(testnet.hash())
})
