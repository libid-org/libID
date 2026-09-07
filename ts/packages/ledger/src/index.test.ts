import { describe, expect, it } from 'vitest'
import { LedgerId } from './index.js'
import { LedgerId as FixtureLedgerId } from './testing.js'

describe('shared ledger contract', () => {
  it('does not admit test identities or pretend to support real ledgers', () => {
    for (const value of ['test:mainnet', 'test:testnet', 'eip155:1', '', null, 1])
      expect(() => LedgerId.decode(value)).toThrow('No ledger definitions')
  })
  it.each(['test:mainnet', 'test:testnet'])(
    'roundtrips the immutable shared fixture %s',
    (encoded) => {
      const ledger = FixtureLedgerId.decode(encoded),
        restored = FixtureLedgerId.decode(ledger.encode())
      expect(restored.constructor).toBe(ledger.constructor)
      expect(Object.isFrozen(restored)).toBe(true)
      expect(restored.encode()).toBe(encoded)
      expect(restored.isTestnet()).toBe(encoded === 'test:testnet')
      expect(restored.hash()).toEqual(ledger.hash())
      restored.hash().fill(99)
      expect(restored.hash()).toEqual(ledger.hash())
    },
  )
})
