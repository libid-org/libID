/** Synthetic identities for ceremony tests, never a production ledger implementation. */
import type { LedgerId as LedgerIdentity } from './index.js'

class FixtureLedgerId implements LedgerIdentity {
  readonly #encoded: string
  constructor(encoded: string) {
    this.#encoded = encoded
    Object.freeze(this)
  }
  encode(): string {
    return this.#encoded
  }
  isTestnet(): boolean {
    return this.#encoded === 'test:testnet'
  }
  hash(): Uint8Array {
    return new Uint8Array(32).fill(this.isTestnet() ? 2 : 1)
  }
}
export const LedgerId = {
  decode(value: unknown): FixtureLedgerId {
    if (value !== 'test:mainnet' && value !== 'test:testnet')
      throw new TypeError('Unsupported fixture ledger')
    return new FixtureLedgerId(value)
  },
}
