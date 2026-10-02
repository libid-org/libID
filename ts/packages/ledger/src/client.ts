import { evm, evmWallet } from './evm/client.js'
import type * as Evm from './evm/index.js'
import type { Indexer } from './indexer.js'
import { LedgerError } from './errors.js'
import { type Account, type Family, isEndpoint, type Ledger, Ledgers as pinned } from './index.js'

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
   * The same result from an indexer. On a ledger with an indexer it answers instead of the
   * chain implementation; a stale or unavailable indexer fails the read with
   * `indexer-unavailable`. Ledgers without an indexer run the chain implementation.
   */
  readonly indexer?: (read: IndexerReader, ...args: A) => Promise<R>
}
/** What to write: one transaction builder per ledger family. */
export type Command<A extends readonly unknown[]> = {
  readonly [F in Family]: (ledger: Ledger<F>, ...args: A) => Families[F]['tx']
}

/**
 * How the client reaches one ledger: through a connected wallet first, then an optional RPC, or
 * through another client serving it. `rpc` and `explorer` replace the ledger's own. Without an
 * RPC, the ledger is read only through a connected wallet, and a wallet that does not know the
 * chain cannot be offered it.
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
   * Connects the wallet the user picked for every served ledger of its family, replacing any
   * wallet connected before. Reads of a ledger then go through it while it is on that chain.
   * Without `prompt`, restores an already authorized wallet and never shows wallet UI.
   */
  connect(
    wallet: Families[L['family']]['wallet'],
    options?: { prompt?: boolean },
  ): Promise<Session<L>>
}

/** A connected wallet, serving every ledger of its family. */
export interface Session<L extends Ledger = Ledger> {
  /** The wallet's current account, following switches; undefined once it shares none. */
  readonly account: Account | undefined
  /** Calls `listener` after the account changes. */
  subscribe(listener: () => void): () => void
  /** Opens the wallet's account picker, then follows the chosen account. */
  chooseAccount(): Promise<Account>
  /**
   * Switches the wallet to the ledger's chain if needed, rechecks the account, simulates, then
   * asks the wallet to send. A `LedgerError` means nothing was sent; any other error leaves the
   * outcome unknown.
   */
  send<K extends L>(ledger: K, tx: Families[K['family']]['tx']): Promise<string>
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
  /** Reads and sends through a connected wallet until detached. */
  attach(wallet: Families[F]['wallet']): Promise<Attachment<F>>
}
export interface Attachment<F extends Family = Family> {
  send(tx: Families[F]['tx'], from: Account): Promise<string>
  detach(): void
}
/** A family's wallet itself: its account, account changes, and its account picker. */
export interface WalletDriver {
  account(prompt: boolean): Promise<Account | null>
  choose(): Promise<void>
  watch(listener: (account: Account | null) => void): () => void
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
  // ponytail: one family, so one connected wallet; keep one per family when a second lands.
  let current: Session | null = null
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
    async connect(wallet, { prompt = true } = {}) {
      // ponytail: one family; pick it by the wallet's shape when a second one lands.
      const driver = evmWallet(wallet)
      let account = await driver.account(prompt)
      if (!account) throw new LedgerError('no-account')
      current?.close()
      const attached = new Map<string, Attachment>()
      for (const { ledger, driver } of routes.values()) {
        attached.set(ledger.chain, await driver.attach(wallet))
      }
      const listeners = new Set<() => void>()
      const notify = () => {
        for (const listener of listeners) listener()
      }
      let closed = false
      const unwatch = driver.watch((next) => {
        account = next
        notify()
      })
      const session: Session = {
        get account() {
          return account ?? undefined
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        async chooseAccount() {
          await driver.choose()
          const chosen = await driver.account(false)
          if (!chosen) throw new LedgerError('no-account')
          account = chosen
          notify()
          return chosen
        },
        async send(ledger, tx) {
          const attachment = attached.get(route(ledger).ledger.chain)
          if (closed || !account || !attachment) throw new LedgerError('no-account')
          return attachment.send(tx, account)
        },
        close() {
          if (closed) return
          closed = true
          unwatch()
          for (const attachment of attached.values()) attachment.detach()
          listeners.clear()
          if (current === session) current = null
        },
      }
      current = session
      return session
    },
  } as LedgerClient<E[number]['ledger']>
}

/** A ledger with an indexer answers queries that support it from the indexer, or fails. */
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
    if (query.indexer && indexer) return indexer.read(ledger, query.indexer, args, options?.signal)
    // Each route pairs a ledger with its own family's driver; the map cannot express that.
    const run = query[ledger.family] as (read: Families[Family]['reader'], ...args: A) => Promise<R>
    return chain(run, args, options)
  }
}

function drive(ledger: Ledger, access: { rpc?: string; explorer?: string }): Driver {
  const rpc = access.rpc ?? ledger.rpc
  const explorer = access.explorer ?? ledger.explorer
  for (const value of [access.rpc, access.explorer]) {
    if (value !== undefined && !isEndpoint(value)) throw new TypeError(`Invalid endpoint: ${value}`)
  }
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
    async attach(wallet) {
      // The outer client already authorized this wallet, so this never prompts.
      const session = await client.connect(wallet, { prompt: false })
      return {
        async send(tx, from) {
          if (session.account !== from) throw new LedgerError('wallet-changed')
          return session.send(ledger, tx)
        },
        detach: () => session.close(),
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
