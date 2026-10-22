// The operation a ceremony is started for. A ceremony binds its proof to an
// operation domain and transaction data; these are fixed test values shaped
// as an EVM `bind` would supply them, so the proof is well-formed. Nothing
// verifies it on a chain.
import type { LedgerId } from '@libid/ledger'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { hexToBytes } from '@noble/hashes/utils.js'

/** A fixed holder for the transaction data; no account behind it is used. */
const HOLDER = '1111111111111111111111111111111111111111'

/** An EVM ledger routed through `notaryUrl`. */
export function evmLedger(notaryUrl: string): LedgerId {
  return { notaryAddress: () => notaryUrl }
}

/** IdentityRegistry's OPERATION_DOMAIN: keccak256("libid.bind-identity"). */
export const operationDomain = keccak_256(new TextEncoder().encode('libid.bind-identity'))

/** `bind`'s Authorized Transaction Data: abi.encode(HOLDER). */
export const transactionData = hexToBytes(`${'0'.repeat(24)}${HOLDER}`)
