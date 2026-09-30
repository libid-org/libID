import type { Address, Hex, PublicClient } from 'viem'
import { eip155 } from './eip155.js'
import type { Account, Ledger, Namespace } from './index.js'

export { LedgerError, type LedgerErrorCode } from './errors.js'

/** A read pinned to one block. Actions default `blockNumber` (or `toBlock`) to `block`. */
export interface Eip155Reader {
  readonly ledger: Ledger<`eip155:${string}`>
  readonly block: bigint
  readonly readContract: PublicClient['readContract']
  readonly getContractEvents: PublicClient['getContractEvents']
  readonly getBalance: PublicClient['getBalance']
  readonly call: PublicClient['call']
  /** A named ledger deployment, checksummed; throws if the ledger has none. */
  address(name: string): Address
  parseAccount(raw: string): Account
}
export interface Eip155Tx {
  to: Address
  data: Hex
  value?: bigint
}
/** The EIP-1193 surface a session uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface Readers {
  eip155: Eip155Reader
}
export interface Txs {
  eip155: Eip155Tx
}
export interface Wallets {
  eip155: Eip1193Provider
}
export type NamespaceOf<L extends Ledger> =
  L['chain'] extends `${infer N extends Namespace}:${string}` ? N : never

/** What to read: one function per namespace. The ledger runs it without interpreting it. */
export type Query<A extends readonly unknown[], R> = {
  readonly [N in Namespace]: (read: Readers[N], ...args: A) => Promise<R>
}
/** What to write: one transaction builder per namespace. */
export type Command<A extends readonly unknown[]> = {
  readonly [N in Namespace]: (ledger: Ledger, ...args: A) => Txs[N]
}

export interface Access {
  rpc: string
  explorer?: string
}

export interface LedgerClient<L extends Ledger = Ledger> {
  readonly ledger: L
  /** What a wallet session needs from a connector, such as WalletConnect. */
  readonly walletRequirements: {
    readonly methods: readonly string[]
    readonly events: readonly string[]
  }
  /** Runs a query against a single block. */
  read<A extends readonly unknown[], R>(
    query: Query<A, R>,
    args: A,
    options?: { signal?: AbortSignal },
  ): Promise<R>
  /** Builds this ledger's transaction for a command. */
  tx<A extends readonly unknown[]>(command: Command<A>, args: A): Txs[NamespaceOf<L>]
  /** Upper bound of the network fee, in native units. */
  estimate(tx: Txs[NamespaceOf<L>], from: Account): Promise<bigint>
  /** Validates an account and returns its canonical form; throws on invalid input. */
  parseAccount(raw: string): Account
  /** Without `prompt`, restores an authorized wallet already on this ledger and never shows wallet UI. */
  connect(wallet: Wallets[NamespaceOf<L>], options?: { prompt?: boolean }): Promise<Session<L>>
}

/** A connected wallet. Reads prefer the wallet's own RPC and fall back to `Access.rpc`. */
export interface Session<L extends Ledger = Ledger> extends Omit<LedgerClient<L>, 'connect'> {
  readonly account: Account
  /**
   * Rechecks the account and chain, simulates, then asks the wallet to send.
   * A `LedgerError` means nothing was sent; any other error leaves the outcome unknown.
   */
  send(tx: Txs[NamespaceOf<L>]): Promise<string>
  close(): void
}

export function connect<L extends Ledger>(ledger: L, access: Access): LedgerClient<L> {
  // ponytail: one namespace; dispatch on it (and lazy-load drivers) when a second one lands.
  return eip155(ledger, access)
}
