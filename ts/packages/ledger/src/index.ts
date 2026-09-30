import * as eip155 from './eip155/chain.js'

/** Ledger definitions own their chain identity, Chain Profile hash and notary routing. */
export interface LedgerId {
  /** CAIP-2 chain identifier, such as `eip155:3735928814`. */
  readonly chain: `${string}:${string}`
  hash(): Uint8Array
  notaryAddress(): string
}

/** Chain namespaces with a ledger implementation. */
export type Namespace = 'eip155'

declare const account: unique symbol
/** An account in its namespace's canonical form (EIP-55 on eip155); produced by a ledger client. */
export type Account = string & { readonly [account]: true }

/** A supported ledger and the libID deployments on it. */
export interface Ledger<
  C extends `${Namespace}:${string}` = `${Namespace}:${string}`,
  A extends Readonly<Record<string, string>> = Readonly<Record<string, string>>,
> extends LedgerId {
  readonly chain: C
  readonly name: string
  readonly testnet: boolean
  readonly currency: Readonly<{ symbol: string; decimals: number }>
  /** Named deployments, stored uninterpreted; consumers give each name its meaning. */
  readonly addresses: A
}

export interface LedgerDefinition<
  C extends `${Namespace}:${string}`,
  A extends Record<string, string>,
> {
  chain: C
  name: string
  testnet: boolean
  currency: { symbol: string; decimals: number }
  notary: string
  addresses: A
}

/** Validates a definition and derives its Chain Profile hash from the chain identifier. */
export function defineLedger<
  const C extends `${Namespace}:${string}`,
  const A extends Record<string, string>,
>(definition: LedgerDefinition<C, A>): Ledger<C, Readonly<A>> {
  const { chain, name, testnet, currency, notary, addresses } = definition
  // ponytail: eip155 only; dispatch on the namespace when a second one lands.
  const hash = eip155.chainHash(chain)
  if (!hash) throw new TypeError(`Unsupported chain: ${chain}`)
  if (
    !name ||
    !currency.symbol ||
    !Number.isInteger(currency.decimals) ||
    currency.decimals < 0 ||
    currency.decimals > 255
  ) {
    throw new TypeError('Invalid ledger name or currency')
  }
  // The notary origin is validated by the ceremony when a run snapshots the ledger.
  for (const [key, value] of Object.entries(addresses)) {
    if (!eip155.isAddress(value)) throw new TypeError(`Invalid ${key} address`)
  }
  return Object.freeze({
    chain,
    name,
    testnet,
    currency: Object.freeze({ ...currency }),
    addresses: Object.freeze({ ...addresses }),
    hash: () => hash.slice(),
    notaryAddress: () => notary,
  })
}

/** Supported ledgers. Consumers supply RPC and indexer endpoints. */
export const ledgers = Object.freeze({
  'eden-testnet': defineLedger({
    chain: 'eip155:3735928814',
    name: 'Eden testnet',
    testnet: true,
    currency: { symbol: 'TIA', decimals: 18 },
    notary: 'https://testnet.notary.lib.id',
    addresses: { identityNames: '0xe78b53a183dd51763df44beb2500ddab9bb0329e' },
  }),
})
