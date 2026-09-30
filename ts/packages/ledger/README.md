# @libid/ledger

Shared `LedgerId` contract for application code (`chain`, `hash()` and
`notaryAddress()`) and the catalog of supported ledgers. See the
[identity contract](docs/identity.md), extracted from architecture PR #13 at
`0259e72c184e2be7b78a0ad92188e8722d8d6daf`.

## Supported ledgers

```ts
import { ledgers } from '@libid/ledger'

const eden = ledgers['eden-testnet']
eden.chain // 'eip155:3735928814'
eden.addresses.identityNames // '0xe78b…'
```

Each entry is a `Ledger`: a `LedgerId` plus its name, testnet flag, native
currency, and the named libID deployments on it. `addresses` is stored
uninterpreted; consumers give each name its meaning and can require the names
they need in their own types. The catalog holds no RPC or indexer endpoints;
consumers supply those.

`defineLedger` validates a definition and derives its Chain Profile hash from
the chain identifier. Use it for local chains:

```ts
import { defineLedger } from '@libid/ledger'

const anvil = defineLedger({
  chain: 'eip155:31337',
  name: 'Anvil',
  testnet: true,
  currency: { symbol: 'ETH', decimals: 18 },
  notary: 'http://localhost:4687',
  addresses: { identityNames: '0x…' },
})
```

Only the EVM family is implemented. Chain identifiers stay CAIP-2, so EVM
ledgers use `eip155:<chain id>`. Ceremony stays chain agnostic; Prover has no
ledger dependency.

## Chain access

`@libid/ledger/client` runs reads and writes without knowing what they mean.
The layer above describes each one once, with one implementation per ledger
family. Every family's implementation takes the same arguments and returns the
same result, but uses its own family's reader, so families never have to share
method names. Each family's types (`Reader`, `Tx`, `Provider`) live in its
module, such as `@libid/ledger/evm`; the client entry point stays
family-agnostic:

```ts
import { connect, type Query } from '@libid/ledger/client'

const resolveHandle: Query<[platform: `0x${string}`, handle: string], `0x${string}`> = {
  evm: (read, platform, handle) =>
    read.readContract({
      address: read.address('identityNames'),
      abi: identityNamesAbi,
      functionName: 'resolveHandle',
      args: [platform, handle],
    }),
}

const client = connect(ledgers['eden-testnet'], { rpc: 'https://…' })
await client.read(resolveHandle, [platform, 'alice'])
```

- `read` pins every action in a query to one chain state, such as one block.
- `tx` builds a command's transaction and `estimate` returns its network fee in
  native units.
- `connect(wallet, { prompt })` returns a `Session`. Without `prompt` it only
  restores an authorized wallet already on this ledger; with it, it may ask for
  accounts and switch or add the chain. Session reads try the wallet's own RPC
  first and fall back to the configured one, discarding any read that crosses a
  chain change.
- `Session.send` rechecks the account and chain and simulates before asking
  the wallet to send. A `LedgerError` from `send` means nothing was sent; any
  other error leaves the outcome unknown.
- `walletRequirements` lists the methods and events a session needs, for
  connectors such as WalletConnect.
- `family` tells clients of different families apart.

### Indexers

A query may add an `indexer` implementation that returns the same result from a
libID indexer:

```ts
const identitiesOf: Query<[account: Account], Identity[]> = {
  evm: async (read, account) => {
    /* accountsOf pages and resolvePair, all at one block */
  },
  indexer: async (read, account) =>
    parseIdentities(await read.get(`/v1/resolve/address/${account}`, { chain })),
}

const client = connect(ledger, { rpc, indexer: { origin, deployment: 'identityNames' } })
```

The client uses it only while the indexer is current. Its status must report
indexing the named deployment on this chain, it must be within `maxLag` blocks
(20 by default) of the head, and its index must not move backwards during the
read. Otherwise, or if the indexer fails, the chain implementation runs: the
chain stays authoritative, and an indexer only makes reads faster. Queries that
must be authoritative, such as checking who owns a handle before relinking, omit
`indexer`. The ledger knows the indexer's status protocol, not its application
endpoints.

The catalog and client take no RPC defaults; consumers supply endpoints.

## Conformance

`src/client.test.ts` is the contract every family's client must meet. It covers
each `LedgerClient` and `Session` member and runs against a harness each family
provides: a fake chain and wallet the suite controls
(`src/conformance.harness.ts`; the EVM one is `src/evm/evm.harness.ts`). A
family without a harness does not compile. Family-specific behavior, such as EVM
fee formulas and chain switching, is tested beside its driver.

## Adding a family

1. Add it to `FamilyNamespaces` in `src/index.ts` with its CAIP-2 namespace, and
   give `defineLedger` its Chain Profile hash and address check from
   `src/<family>/chain.ts`.
2. Create `src/<family>/index.ts` with the family's `Reader`, `Tx` and `Provider`
   types, and `src/<family>/client.ts` implementing `LedgerClient`. Export
   `./<family>` from `package.json`.
3. Add one entry to `Families` in `src/client.ts`, dispatch to the new driver in
   `connect`, and register the family's harness in `src/client.test.ts`.

The compiler then flags the harness registry, the `connect` dispatch, and every
`Query` and `Command` without the new family, in this package and in its
consumers. Existing families and family-agnostic code do not change.

## Shared test fixture

```ts
import { testnet } from '@libid/ledger/testing'

const localLedger = { ...testnet, notaryAddress: () => 'http://localhost:4687' }
```

The testing entrypoint exports `mainnet` and `testnet`, synthetic identities with
dummy 32-byte hashes and `test:` chain identifiers. They establish no real ledger
conformance. A local fixture can change the notary address without changing its
hash. Fixtures belong to the application or tests; CCDP uses the same
distribution for every ledger.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build`,
`pnpm --filter @libid/ledger typecheck`, and `pnpm --filter @libid/ledger test`.
