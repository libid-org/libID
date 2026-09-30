# @libid/ledger

Shared `LedgerId` contract for application code (`chain`, `hash()` and
`notaryAddress()`) and the catalog of supported ledgers. See the
[identity contract](docs/identity.md).

## Supported ledgers

```ts
import { Ledgers } from '@libid/ledger'

const eden = Ledgers.EdenTestnet
eden.chain // 'eip155:3735928814'
eden.addresses.identityNames // '0x5b86…'
```

Each entry is a `Ledger`: a `LedgerId` plus its name, testnet flag, native
currency, and the named libID deployments on it. `addresses` is stored
uninterpreted; consumers give each name its meaning and can require the names
they need in their own types. libID pins no RPCs: consumers configure one where
they want reads before a wallet connects, or wallets to be offered the chain.
Catalog ledgers carry a public `explorer` where one exists. Catalog ledgers are
pinned: a client serves a catalog chain only with its catalog definition, so its
deployments and notary cannot be changed.

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

`@libid/ledger/client` reads and writes across every ledger a client serves.
The client runs reads and writes without knowing what they mean: the layer above
describes each one once, with one implementation per ledger family. Every
family's implementation takes the same arguments and returns the same result,
but uses its own family's reader, so families never share method names. Each
family's types (`Reader`, `Tx`, `Provider`) live in its module, such as
`@libid/ledger/evm`; the client entry point stays family-agnostic.

```ts
import { connect, indexer, type Query } from '@libid/ledger/client'

const resolveHandle: Query<[platform: `0x${string}`, handle: string], `0x${string}`> = {
  evm: (read, platform, handle) =>
    read.readContract({
      address: read.address('identityNames'),
      abi: identityNamesAbi,
      functionName: 'resolveHandle',
      args: [platform, handle],
    }),
}

const client = connect({
  ledgers: [
    { ledger: Ledgers.EdenTestnet }, // read through the connected wallet
    { ledger: anvil, rpc: 'http://127.0.0.1:8545', indexer: false },
  ],
  indexer: indexer({ origin: 'https://…', deployment: 'identityNames' }),
})
await client.read(Ledgers.EdenTestnet, resolveHandle, [platform, 'alice'])
```

- Every method takes the ledger it acts on. `client.ledger(chain)` finds a
  served ledger by chain identifier, such as one a wallet reports.
- `read` pins every action in a query to one state of the ledger, such as one
  block.
- `tx` builds a command's transaction and `estimate` returns its network fee in
  the ledger's native units.
- `connect(wallet, { prompt })` connects the wallet the user picked for every
  served ledger of its family, replacing any connected before; without
  `prompt` it only restores an already authorized wallet. The client then reads
  each ledger through that wallet while it is on the ledger's chain, then the
  ledger's RPC, discarding any read that crosses a chain change. With neither,
  a read fails with `unreachable`.
- The `Session` follows the wallet: `account` tracks account switches,
  `subscribe` reports them, and `chooseAccount()` opens the wallet's account
  picker.
- `session.send(ledger, tx)` switches the wallet to the ledger's chain if
  needed, rechecks the account, and simulates before asking the wallet to send.
  A `LedgerError` from `send` means nothing was sent; any other error leaves the
  outcome unknown.
- `walletRequirements` lists, per CAIP-2 namespace, the chains, methods and
  events wallet connectors such as WalletConnect must request.

Each entry in `ledgers` reaches its ledger through the connected wallet and an
optional RPC, or through another client (`{ ledger, client }`), such as a custom
one. An entry's `rpc` and `explorer` replace the ledger's own. Without an RPC, a
wallet that does not know the chain cannot be offered it.

### Indexers

A query may add an `indexer` implementation that returns the same result from a
libID indexer. One indexer serves every chain it reports:

```ts
const identitiesOf: Query<[account: Account], Identity[]> = {
  evm: async (read, account) => {
    /* accountsOf pages and resolvePair, all at one block */
  },
  indexer: async (read, account) =>
    parseIdentities(await read.get(`/v1/resolve/address/${account}`, { chain })),
}
```

The client's `indexer` is the default for every ledger; an entry's `indexer`
replaces it for that ledger, and `indexer: false` gives that ledger none. On a
ledger with an indexer, queries with an `indexer` implementation are answered by
the indexer alone. Its status must report the named deployment on that chain,
within `maxLag` blocks (20 by default) of the head, and its index must not move
backwards during the read; otherwise the read fails with `indexer-unavailable`,
without falling back to the chain. Queries without an `indexer` implementation,
such as checking who owns a handle before relinking, always read the chain. The
ledger knows the indexer's status protocol, not its application endpoints.

## Conformance

`src/client.test.ts` is the contract every family's client must meet. It covers
every `LedgerClient` and `Session` member, including serving several ledgers,
and runs against a harness each family provides: fake chains and wallets the
suite controls (`src/conformance.harness.ts`; the EVM one is
`src/evm/evm.harness.ts`). It runs again with an unavailable default indexer,
which must change nothing for queries without an indexer implementation. A family without a harness does not compile.
Family-specific behavior, such as EVM fee formulas and chain switching, is
tested beside its driver.

## Adding a family

1. Add it to `namespaces` in `src/index.ts` with its CAIP-2 namespace, and give
   `defineLedger` its Chain Profile hash and address check from
   `src/<family>/chain.ts`.
2. Create `src/<family>/index.ts` with the family's `Reader`, `Tx` and
   `Provider` types, and `src/<family>/client.ts` implementing `Driver`. Export
   `./<family>` from `package.json`.
3. Add one entry to `Families` in `src/client.ts`, dispatch to the new driver in
   `drive`, and register the family's harness in `src/client.test.ts`.

The compiler then flags the harness registry, the driver dispatch, and every
`Query` and `Command` without the new family, in this package and in its
consumers. Existing families and family-agnostic code do not change.

## Fixtures

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts), whose chain
identifiers use the `test` namespace. A synthetic identity establishes no real
ledger conformance, and a local fixture can change the notary address without
changing its hash.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build`,
`pnpm --filter @libid/ledger typecheck`, and `pnpm --filter @libid/ledger test`.
