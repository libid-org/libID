import type { LedgerId } from '@libid/ledger'

/** Synthetic ledgers for tests; neither represents a production ledger. */
export const mainnet: LedgerId = Object.freeze({
  notaryAddress: () => 'https://notary.lib.id',
})
export const testnet: LedgerId = Object.freeze({
  notaryAddress: () => 'https://testnet.notary.lib.id',
})
