import type { Address, Hex, PublicClient } from 'viem'
import type { Account, Ledger } from '../index.js'

/** A read pinned to one block. Actions default `blockNumber` (or `toBlock`) to `block`. */
export interface Reader {
  readonly ledger: Ledger<'evm'>
  readonly block: bigint
  readonly readContract: PublicClient['readContract']
  readonly getContractEvents: PublicClient['getContractEvents']
  readonly getBalance: PublicClient['getBalance']
  readonly call: PublicClient['call']
  /** A named ledger deployment, checksummed; throws if the ledger has none. */
  address(name: string): Address
  parseAccount(raw: string): Account
}

export interface Tx {
  to: Address
  data: Hex
  value?: bigint
}

/** The EIP-1193 surface a session uses. */
export interface Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}
