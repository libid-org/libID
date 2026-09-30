import { eip155 } from './eip155/client.js'
import type * as Eip155 from './eip155/index.js'
import type { Account, Ledger, Namespace } from './index.js'

export { LedgerError, type LedgerErrorCode } from './errors.js'

/**
 * Each supported namespace's own types, defined in its module. Besides the `connect`
 * dispatch, the only place this entry point names a namespace: adding one adds one entry.
 */
export interface Namespaces {
  eip155: { reader: Eip155.Reader; tx: Eip155.Tx; wallet: Eip155.Provider }
}
type Tx<L extends Ledger> = Namespaces[NamespaceOf<L>]['tx']
export type NamespaceOf<L extends Ledger> =
  L['chain'] extends `${infer N extends Namespace}:${string}` ? N : never

/** What to read: one function per namespace. The ledger runs it without interpreting it. */
export type Query<A extends readonly unknown[], R> = {
  readonly [N in Namespace]: (read: Namespaces[N]['reader'], ...args: A) => Promise<R>
}
/** What to write: one transaction builder per namespace. */
export type Command<A extends readonly unknown[]> = {
  readonly [N in Namespace]: (ledger: Ledger, ...args: A) => Namespaces[N]['tx']
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
  tx<A extends readonly unknown[]>(command: Command<A>, args: A): Tx<L>
  /** Upper bound of the network fee, in native units. */
  estimate(tx: Tx<L>, from: Account): Promise<bigint>
  /** Validates an account and returns its canonical form; throws on invalid input. */
  parseAccount(raw: string): Account
  /** Without `prompt`, restores an authorized wallet already on this ledger and never shows wallet UI. */
  connect(
    wallet: Namespaces[NamespaceOf<L>]['wallet'],
    options?: { prompt?: boolean },
  ): Promise<Session<L>>
}

/** A connected wallet. Reads prefer the wallet's own RPC and fall back to `Access.rpc`. */
export interface Session<L extends Ledger = Ledger> extends Omit<LedgerClient<L>, 'connect'> {
  readonly account: Account
  /**
   * Rechecks the account and chain, simulates, then asks the wallet to send.
   * A `LedgerError` means nothing was sent; any other error leaves the outcome unknown.
   */
  send(tx: Tx<L>): Promise<string>
  close(): void
}

export function connect<L extends Ledger>(ledger: L, access: Access): LedgerClient<L> {
  // ponytail: one namespace; dispatch on it (and lazy-load drivers) when a second one lands.
  return eip155(ledger, access)
}
