/** Synthetic identities for tests; neither represents a production ledger. */
import type { LedgerId } from './index.js'

export const mainnet: LedgerId = Object.freeze({
  hash: () => new Uint8Array(32).fill(1),
  notaryAddress: () => 'https://notary.lib.id',
})
export const testnet: LedgerId = Object.freeze({
  hash: () => new Uint8Array(32).fill(2),
  notaryAddress: () => 'https://testnet.notary.lib.id',
})
