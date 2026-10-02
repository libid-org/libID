import { type Account, type Ledger, Ledgers } from '@libid/ledger'
import {
  connect,
  type Indexer,
  indexer,
  type LedgerAccess,
  type LedgerClient,
  type WalletRequirements,
} from '@libid/ledger/client'

/** A ledger with the libID identity registry, `identityRegistry`, deployed on it. */
export type IdentityLedger = Ledger & { readonly addresses: { readonly identityRegistry: string } }

/** A pinned ledger with the identity registry, served by default. */
export type PinnedLedger = Extract<(typeof Ledgers)[keyof typeof Ledgers], IdentityLedger>

/** An integrator fee, in the ledger's native units, bound into every proof made on it. */
export interface Fee {
  readonly amount: bigint
  readonly recipient: Account
}

/**
 * One ledger the client serves, how it is reached besides its connected wallet, and what the
 * integrator charges on it. An entry for a pinned ledger configures it; any other ledger's adds it.
 */
export type IdentityAccess<L extends IdentityLedger = IdentityLedger> = {
  ledger: L
  /** An integrator fee bound into proofs made on this ledger. Omit it to charge none. */
  fee?: { amount: bigint; recipient: string }
  /** Replaces the default names indexer origin for this ledger; `false` gives it none. */
  indexer?: string | false
} & ({ rpc?: string; explorer?: string } | { client: LedgerClient })

export interface IdentityOptions<E extends readonly IdentityAccess[] = readonly IdentityAccess[]> {
  /** Entries configuring pinned ledgers or adding others. */
  ledgers?: E
  /** Pinned ledgers to leave out. */
  exclude?: readonly PinnedLedger[]
  /** The origin of a libID names indexer, which answers identity lists on every ledger. */
  indexer?: string
}

/** libID identities across every ledger it serves. */
export interface IdentityClient<L extends IdentityLedger = IdentityLedger> {
  readonly ledgers: readonly L[]
  /** A served ledger by chain identifier, such as one a wallet reports. */
  ledger(chain: string): L | undefined
  /** What wallet connectors must request, per CAIP-2 namespace. */
  readonly walletRequirements: WalletRequirements
  /** The integrator fee charged on a ledger, if any. */
  fee(ledger: L): Fee | undefined
}

/**
 * Serves every pinned ledger with the identity registry, read through the connected wallet and
 * any configured RPC, configured and extended by `ledgers`.
 */
export function createIdentityClient<const E extends readonly IdentityAccess[] = []>(
  options: IdentityOptions<E> = {},
): IdentityClient<PinnedLedger | E[number]['ledger']> {
  const entries: readonly IdentityAccess[] = options.ledgers ?? []
  const configured = new Map<string, IdentityAccess>(
    entries.map((entry) => [entry.ledger.chain, entry]),
  )
  if (configured.size !== entries.length) throw new TypeError('More than one entry for a ledger')
  const excluded = new Set<string>((options.exclude ?? []).map(({ chain }) => chain))
  const pinned = Object.values(Ledgers).filter(
    (ledger) => ledger.addresses.identityRegistry && !excluded.has(ledger.chain),
  )
  for (const chain of excluded) {
    if (configured.has(chain)) throw new TypeError(`${chain} is both configured and excluded`)
  }
  const served: IdentityAccess[] = [
    ...pinned.map((ledger) => configured.get(ledger.chain) ?? { ledger }),
    ...entries.filter(({ ledger }) => !pinned.some(({ chain }) => chain === ledger.chain)),
  ]
  for (const { ledger } of served) {
    if (!ledger.addresses.identityRegistry) {
      throw new TypeError(`${ledger.name} has no identityRegistry address`)
    }
  }
  const names = (origin: string): Indexer => indexer({ origin, deployment: 'identityRegistry' })
  const chain = connect({
    ledgers: served.map(
      ({ fee: _, indexer: origin, ...access }): LedgerAccess => ({
        ...access,
        indexer: typeof origin === 'string' ? names(origin) : origin,
      }),
    ),
    indexer: options.indexer === undefined ? undefined : names(options.indexer),
  })
  const fees = new Map<string, Fee>()
  for (const { ledger, fee } of served) {
    if (!fee) continue
    if (typeof fee.amount !== 'bigint' || fee.amount <= 0n) {
      throw new TypeError(
        `The ${ledger.name} fee must be a positive amount; omit it to charge none`,
      )
    }
    const recipient = chain.parseAccount(ledger, fee.recipient)
    fees.set(ledger.chain, Object.freeze({ amount: fee.amount, recipient }))
  }
  return {
    ledgers: chain.ledgers,
    ledger: chain.ledger,
    walletRequirements: chain.walletRequirements,
    fee: (ledger) => fees.get(ledger.chain),
  } as IdentityClient<PinnedLedger | E[number]['ledger']>
}
