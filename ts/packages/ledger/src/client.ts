import { evm } from './evm/client.js'
import type * as Evm from './evm/index.js'
import { type Indexer, type IndexerAccess, indexer } from './indexer.js'
import type { Account, Chain, Family, Ledger } from './index.js'

export { LedgerError, type LedgerErrorCode } from './errors.js'
export type { IndexerAccess } from './indexer.js'

/**
 * Each ledger family's own types, defined in its module. Besides the `connect` dispatch,
 * the only place this entry point names a family: adding one adds one entry.
 */
export interface Families {
  evm: { reader: Evm.Reader; tx: Evm.Tx; wallet: Evm.Provider }
}
export type FamilyOf<L extends Ledger> = {
  [F in Family]: L['chain'] extends Chain<F> ? F : never
}[Family]

/** Reads from a libID indexer, which serves state as of `block`, the last one it processed. */
export interface IndexerReader {
  readonly ledger: Ledger
  readonly block: bigint
  /** GETs a JSON object; throws on HTTP errors and non-object responses. */
  get(path: string, params?: Record<string, string>): Promise<Record<string, unknown>>
}

/**
 * What to read: one function per ledger family, reading the chain. The ledger runs it
 * without interpreting it.
 */
export type Query<A extends readonly unknown[], R> = {
  readonly [F in Family]: (read: Families[F]['reader'], ...args: A) => Promise<R>
} & {
  /**
   * The same result from an indexer. Used when the client has a current indexer; otherwise,
   * or if the indexer fails, the chain implementation runs.
   */
  readonly indexer?: (read: IndexerReader, ...args: A) => Promise<R>
}
/** What to write: one transaction builder per ledger family. */
export type Command<A extends readonly unknown[]> = {
  readonly [F in Family]: (ledger: Ledger, ...args: A) => Families[F]['tx']
}

export interface Access {
  rpc: string
  explorer?: string
  /** A libID indexer that queries with an `indexer` implementation read first. */
  indexer?: IndexerAccess
}

/**
 * A ledger client, typed by its family so code generic over families type-checks.
 * Code holding clients of several families narrows them on `family`.
 */
export interface LedgerClient<F extends Family = Family, L extends Ledger = Ledger<Chain<F>>> {
  readonly family: F
  readonly ledger: L
  /** What a wallet session needs from a connector, such as WalletConnect. */
  readonly walletRequirements: {
    readonly methods: readonly string[]
    readonly events: readonly string[]
  }
  /** Runs a query against one chain state, from a current indexer when the query supports it. */
  read<A extends readonly unknown[], R>(
    query: Query<A, R>,
    args: A,
    options?: { signal?: AbortSignal },
  ): Promise<R>
  /** Builds this ledger's transaction for a command. */
  tx<A extends readonly unknown[]>(command: Command<A>, args: A): Families[F]['tx']
  /** Upper bound of the network fee, in native units. */
  estimate(tx: Families[F]['tx'], from: Account): Promise<bigint>
  /** Validates an account and returns its canonical form; throws on invalid input. */
  parseAccount(raw: string): Account
  /** Without `prompt`, restores an authorized wallet already on this ledger and never shows wallet UI. */
  connect(wallet: Families[F]['wallet'], options?: { prompt?: boolean }): Promise<Session<F, L>>
}

/** A connected wallet. Reads prefer the wallet's own RPC and fall back to `Access.rpc`. */
export interface Session<F extends Family = Family, L extends Ledger = Ledger<Chain<F>>>
  extends Omit<LedgerClient<F, L>, 'connect'> {
  readonly account: Account
  /**
   * Rechecks the account and chain, simulates, then asks the wallet to send.
   * A `LedgerError` means nothing was sent; any other error leaves the outcome unknown.
   */
  send(tx: Families[F]['tx']): Promise<string>
  close(): void
}

export function connect<L extends Ledger>(ledger: L, access: Access): LedgerClient<FamilyOf<L>, L> {
  // ponytail: one family; dispatch on it (and lazy-load drivers) when a second one lands.
  const client = evm(ledger, access) as LedgerClient<FamilyOf<L>, L>
  if (!access.indexer) return client
  const source = indexer(ledger, access.indexer)
  return {
    ...client,
    read: preferIndexer(client.read, source),
    async connect(wallet, options) {
      const session = await client.connect(wallet, options)
      return { ...session, read: preferIndexer(session.read, source) }
    },
  }
}

function preferIndexer(chain: LedgerClient['read'], source: Indexer): LedgerClient['read'] {
  return async (query, args, options) => {
    if (query.indexer) {
      try {
        return await source.read(query.indexer, args, options?.signal)
      } catch (error) {
        // The chain stays authoritative: an unavailable or stale indexer only costs speed.
        if (options?.signal?.aborted) throw error
      }
    }
    return chain(query, args, options)
  }
}
