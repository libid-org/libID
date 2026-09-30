import { evm } from './evm/client.js'
import type * as Evm from './evm/index.js'
import type { Indexer } from './indexer.js'
import { type Account, type Family, type Ledger, ledgers as pinned } from './index.js'

export { LedgerError, type LedgerErrorCode } from './errors.js'
export { type Indexer, type IndexerOptions, indexer } from './indexer.js'

/**
 * Each ledger family's own types, defined in its module. Besides the driver dispatch in
 * `connect`, the only place this entry point names a family: adding one adds one entry.
 */
export interface Families {
  evm: { reader: Evm.Reader; tx: Evm.Tx; wallet: Evm.Provider }
}

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
   * The same result from an indexer, used while the ledger's indexer is current; otherwise,
   * or if the indexer fails, the chain implementation runs.
   */
  readonly indexer?: (read: IndexerReader, ...args: A) => Promise<R>
}
/** What to write: one transaction builder per ledger family. */
export type Command<A extends readonly unknown[]> = {
  readonly [F in Family]: (ledger: Ledger<F>, ...args: A) => Families[F]['tx']
}

/**
 * How the client reaches one ledger: through a connected wallet first, then an RPC, or through
 * another client serving it. `rpc` and `explorer` replace the ledger's public ones; a ledger
 * without a public RPC needs `rpc`.
 */
export type LedgerAccess<L extends Ledger = Ledger> = (
  | { ledger: L; rpc?: string; explorer?: string }
  | { ledger: L; client: LedgerClient }
) & {
  /** Replaces the client's default indexer for this ledger; `false` reads only the chain. */
  indexer?: Indexer | false
}

/** What connectors must request from wallets, as CAIP-25 namespaces. */
export type WalletRequirements = Readonly<
  Record<
    string,
    {
      readonly chains: readonly string[]
      readonly methods: readonly string[]
      readonly events: readonly string[]
    }
  >
>

/** Reads and writes across every ledger it serves. */
export interface LedgerClient<L extends Ledger = Ledger> {
  readonly ledgers: readonly L[]
  /** A served ledger by chain identifier, such as one a wallet reports. */
  ledger(chain: string): L | undefined
  readonly walletRequirements: WalletRequirements
  /** Runs a query against one state of a ledger, through its connected wallet when there is one. */
  read<A extends readonly unknown[], R>(
    ledger: L,
    query: Query<A, R>,
    args: A,
    options?: { signal?: AbortSignal },
  ): Promise<R>
  /** Builds a ledger's transaction for a command. */
  tx<K extends L, A extends readonly unknown[]>(
    ledger: K,
    command: Command<A>,
    args: A,
  ): Families[K['family']]['tx']
  /** Upper bound of the network fee, in the ledger's native units. */
  estimate<K extends L>(ledger: K, tx: Families[K['family']]['tx'], from: Account): Promise<bigint>
  /** Validates an account and returns its canonical form; throws on invalid input. */
  parseAccount(ledger: L, raw: string): Account
  /**
   * Connects a wallet on the ledger; the ledger's reads then go through it until it closes.
   * Without `prompt`, restores an authorized wallet already on the ledger and never shows wallet UI.
   */
  connect<K extends L>(
    ledger: K,
    wallet: Families[K['family']]['wallet'],
    options?: { prompt?: boolean },
  ): Promise<Session<K>>
}

/** A wallet connected on one ledger. */
export interface Session<L extends Ledger = Ledger> {
  readonly ledger: L
  readonly account: Account
  estimate(tx: Families[L['family']]['tx']): Promise<bigint>
  /**
   * Rechecks the account and chain, simulates, then asks the wallet to send.
   * A `LedgerError` means nothing was sent; any other error leaves the outcome unknown.
   */
  send(tx: Families[L['family']]['tx']): Promise<string>
  close(): void
}

/** One ledger's operations, implemented by each family's driver. */
export interface Driver<F extends Family = Family> {
  readonly walletRequirements: {
    readonly methods: readonly string[]
    readonly events: readonly string[]
  }
  read<A extends readonly unknown[], R>(
    run: (read: Families[F]['reader'], ...args: A) => Promise<R>,
    args: A,
    options?: { signal?: AbortSignal },
  ): Promise<R>
  estimate(tx: Families[F]['tx'], from: Account): Promise<bigint>
  parseAccount(raw: string): Account
  connect(wallet: Families[F]['wallet'], options?: { prompt?: boolean }): Promise<SessionDriver<F>>
}
export interface SessionDriver<F extends Family = Family> {
  readonly account: Account
  estimate(tx: Families[F]['tx']): Promise<bigint>
  send(tx: Families[F]['tx']): Promise<string>
  close(): void
}

type Route = { ledger: Ledger; driver: Driver; indexer?: Indexer | false }

export function connect<const E extends readonly LedgerAccess[]>(options: {
  ledgers: E
  /** Read first, for every ledger, by queries with an indexer implementation. */
  indexer?: Indexer
}): LedgerClient<E[number]['ledger']> {
  const routes = new Map<string, Route>()
  const pinnedByChain = new Map<string, Ledger>(Object.values(pinned).map((l) => [l.chain, l]))
  for (const access of options.ledgers) {
    const { ledger } = access
    if (routes.has(ledger.chain)) throw new TypeError(`More than one entry for ${ledger.chain}`)
    const own = pinnedByChain.get(ledger.chain)
    if (own && own !== ledger) {
      throw new TypeError(`${ledger.chain} is pinned: serve libID's ${own.name} definition as is`)
    }
    const source = access.indexer ?? options.indexer
    if (source && !ledger.addresses[source.deployment]) {
      throw new TypeError(`${ledger.name} has no ${source.deployment} address`)
    }
    const driver = 'client' in access ? delegate(access.client, ledger) : drive(ledger, access)
    routes.set(ledger.chain, { ledger, driver, indexer: source })
  }
  const route = (ledger: Ledger) => {
    const found = routes.get(ledger.chain)
    if (!found) throw new TypeError(`${ledger.name} is not served by this client`)
    return found
  }
  return {
    ledgers: Object.freeze([...routes.values()].map(({ ledger }) => ledger)),
    ledger: (chain: string) => routes.get(chain)?.ledger,
    walletRequirements: requirements([...routes.values()]),
    read: async (ledger, query, args, options) => {
      const found = route(ledger)
      return read(found, found.driver.read)(query, args, options)
    },
    tx: (ledger, command, args) => command[ledger.family](ledger as never, ...args),
    estimate: async (ledger, tx, from) => route(ledger).driver.estimate(tx, from),
    parseAccount: (ledger, raw) => route(ledger).driver.parseAccount(raw),
    async connect(ledger, wallet, options) {
      const found = route(ledger)
      const session = await found.driver.connect(wallet, options)
      return {
        ledger,
        account: session.account,
        estimate: session.estimate,
        send: session.send,
        close: session.close,
      }
    },
  } as LedgerClient<E[number]['ledger']>
}

/** Reads a current indexer first when the query supports it; the chain stays authoritative. */
type Read = <A extends readonly unknown[], R>(
  query: Query<A, R>,
  args: A,
  options?: { signal?: AbortSignal },
) => Promise<R>

function read({ ledger, indexer }: Route, chain: Driver['read']): Read {
  return async <A extends readonly unknown[], R>(
    query: Query<A, R>,
    args: A,
    options?: { signal?: AbortSignal },
  ): Promise<R> => {
    if (query.indexer && indexer) {
      try {
        return await indexer.read(ledger, query.indexer, args, options?.signal)
      } catch (error) {
        // An unavailable or stale indexer only costs speed.
        if (options?.signal?.aborted) throw error
      }
    }
    // Each route pairs a ledger with its own family's driver; the map cannot express that.
    const run = query[ledger.family] as (read: Families[Family]['reader'], ...args: A) => Promise<R>
    return chain(run, args, options)
  }
}

function drive(ledger: Ledger, access: { rpc?: string; explorer?: string }): Driver {
  const rpc = access.rpc ?? ledger.rpc
  if (!rpc) throw new TypeError(`${ledger.name} has no public RPC; configure one`)
  const explorer = access.explorer ?? ledger.explorer
  // ponytail: one family; dispatch on `ledger.family` (and lazy-load drivers) when a second lands.
  return evm(ledger, { rpc, explorer })
}

/** Serves a ledger through another client, such as a custom or differently configured one. */
function delegate(client: LedgerClient, ledger: Ledger): Driver {
  const only = (run: unknown) => ({ [ledger.family]: run }) as unknown as Query<never, never>
  const namespace = ledger.chain.slice(0, ledger.chain.indexOf(':'))
  return {
    get walletRequirements() {
      const { methods = [], events = [] } = client.walletRequirements[namespace] ?? {}
      return { methods, events }
    },
    read: (run, args, options) => client.read(ledger, only(run), args as never, options),
    estimate: (tx, from) => client.estimate(ledger, tx, from),
    parseAccount: (raw) => client.parseAccount(ledger, raw),
    async connect(wallet, options) {
      const session = await client.connect(ledger, wallet, options)
      return {
        account: session.account,
        estimate: session.estimate,
        send: session.send,
        close: session.close,
      }
    },
  }
}

function requirements(routes: Route[]): WalletRequirements {
  const namespaces: Record<
    string,
    { chains: string[]; methods: Set<string>; events: Set<string> }
  > = {}
  for (const { ledger, driver } of routes) {
    const namespace = ledger.chain.slice(0, ledger.chain.indexOf(':'))
    namespaces[namespace] ??= { chains: [], methods: new Set(), events: new Set() }
    namespaces[namespace].chains.push(ledger.chain)
    for (const method of driver.walletRequirements.methods)
      namespaces[namespace].methods.add(method)
    for (const event of driver.walletRequirements.events) namespaces[namespace].events.add(event)
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(namespaces).map(([namespace, { chains, methods, events }]) => [
        namespace,
        Object.freeze({ chains, methods: [...methods], events: [...events] }),
      ]),
    ),
  )
}
