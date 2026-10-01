import * as evm from './evm/chain.js'

/** Ledger definitions own their chain identity, Chain Profile hash and notary routing. */
export interface LedgerId {
  /** CAIP-2 chain identifier, such as `eip155:3735928814`. */
  readonly chain: `${string}:${string}`
  hash(): Uint8Array
  notaryAddress(): string
}

/** Each ledger family and the CAIP-2 namespace of its chain identifiers. */
const namespaces = { evm: 'eip155' } as const
export type FamilyNamespaces = typeof namespaces
export type Family = keyof FamilyNamespaces
type SupportedChain = `${FamilyNamespaces[Family]}:${string}`
/**
 * A chain identifier of a supported family, such as `eip155:3735928814`. `Extract` lets
 * code that is generic over a family still satisfy `Chain`.
 */
export type Chain<F extends Family = Family> = Extract<
  `${FamilyNamespaces[F]}:${string}`,
  SupportedChain
>
export type FamilyOfChain<C extends string> = {
  [F in Family]: C extends Chain<F> ? F : never
}[Family]

declare const account: unique symbol
/** An account in its namespace's canonical form (EIP-55 on EVM ledgers); produced by a ledger client. */
export type Account = string & { readonly [account]: true }

/** A supported ledger and the libID deployments on it. */
export interface Ledger<
  F extends Family = Family,
  C extends Chain = Chain<F>,
  A extends Readonly<Record<string, string>> = Readonly<Record<string, string>>,
> extends LedgerId {
  /** The ledger family, from the chain identifier's namespace. */
  readonly family: F
  readonly chain: C
  readonly name: string
  readonly testnet: boolean
  readonly currency: Readonly<{ symbol: string; decimals: number }>
  /** Named deployments, stored uninterpreted; consumers give each name its meaning. */
  readonly addresses: A
  /** An RPC: the read fallback after a connected wallet, and what wallets can add the chain with. */
  readonly rpc?: string
  /** A public block explorer. */
  readonly explorer?: string
}

export interface LedgerDefinition<C extends Chain, A extends Record<string, string>> {
  chain: C
  name: string
  testnet: boolean
  currency: { symbol: string; decimals: number }
  notary: string
  addresses: A
  rpc?: string
  explorer?: string
}

/** Validates a definition and derives its Chain Profile hash from the chain identifier. */
export function defineLedger<const C extends Chain, const A extends Record<string, string>>(
  definition: LedgerDefinition<C, A>,
): Ledger<FamilyOfChain<C>, C, Readonly<A>> {
  const { chain, name, testnet, currency, notary, addresses, rpc, explorer } = definition
  const family = (Object.keys(namespaces) as Family[]).find((key) =>
    chain.startsWith(`${namespaces[key]}:`),
  )
  // ponytail: EVM only; dispatch on the family when a second one lands.
  const hash = family === 'evm' ? evm.chainHash(chain) : null
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
    if (!evm.isAddress(value)) throw new TypeError(`Invalid ${key} address`)
  }
  for (const value of [rpc, explorer]) {
    if (value !== undefined && !isEndpoint(value)) throw new TypeError(`Invalid endpoint: ${value}`)
  }
  return Object.freeze({
    family: family as FamilyOfChain<C>,
    chain,
    name,
    testnet,
    currency: Object.freeze({ ...currency }),
    addresses: Object.freeze({ ...addresses }),
    hash: () => hash.slice(),
    notaryAddress: () => notary,
    ...(rpc && { rpc }),
    ...(explorer && { explorer }),
  })
}

/** An HTTPS URL without credentials or fragment, or HTTP on localhost for development. */
export function isEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    !url.username &&
    !url.password &&
    !url.hash &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
}

/**
 * Supported ledgers, pinned: served only as defined here. Deployments mirror libID's
 * chain-configurations network files. libID pins no RPCs: reads go through the connected wallet
 * or an RPC the consumer configures. Explorers are pinned where public; consumers may override.
 */
export const Ledgers = Object.freeze({
  EdenTestnet: defineLedger({
    chain: 'eip155:3735928814',
    name: 'Eden testnet',
    testnet: true,
    currency: { symbol: 'TIA', decimals: 18 },
    notary: 'https://testnet.notary.lib.id',
    addresses: { identityRegistry: '0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366' },
    explorer: 'https://eden-testnet.blockscout.com',
  }),
  Sepolia: defineLedger({
    chain: 'eip155:11155111',
    name: 'Sepolia',
    testnet: true,
    currency: { symbol: 'ETH', decimals: 18 },
    notary: 'https://testnet.notary.lib.id',
    addresses: { identityRegistry: '0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366' },
    explorer: 'https://sepolia.etherscan.io',
  }),
})
