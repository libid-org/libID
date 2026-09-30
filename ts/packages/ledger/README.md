# @libid/ledger

Shared `LedgerId` contract for application code (`chain`, `hash()` and
`notaryAddress()`) and the catalog of supported ledgers. See the
[identity contract](docs/identity.md).

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
    { ledger: ledgers['eden-testnet'], rpc: 'https://…' },
    { ledger: anvil, rpc: 'http://127.0.0.1:8545', indexer: false },
  ],
  indexer: indexer({ origin: 'https://…', deployment: 'identityNames' }),
})
await client.read(ledgers['eden-testnet'], resolveHandle, [platform, 'alice'])
```

- Every method takes the ledger it acts on. `client.ledger(chain)` finds a
  served ledger by chain identifier, such as one a wallet reports.
- `read` pins every action in a query to one state of the ledger, such as one
  block.
- `tx` builds a command's transaction and `estimate` returns its network fee in
  the ledger's native units.
- `connect(ledger, wallet, { prompt })` returns a `Session` on that ledger.
  Without `prompt` it only restores an authorized wallet already on the ledger;
  with it, it may ask for accounts and switch or add the chain. Session reads
  try the wallet's own RPC first, discarding any read that crosses a chain
  change.
- `Session.send` rechecks the account and chain and simulates before asking
  the wallet to send. A `LedgerError` from `send` means nothing was sent; any
  other error leaves the outcome unknown.
- `walletRequirements` lists, per CAIP-2 namespace, the chains, methods and
  events wallet connectors such as WalletConnect must request.

Each entry in `ledgers` reaches its ledger through an RPC endpoint, or through
another client (`{ ledger, client }`), such as a custom one. The catalog and
client take no endpoint defaults; consumers supply them.

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
replaces it for that ledger, and `indexer: false` reads only the chain. A
ledger's indexer is used only while it is current: its status must report the
named deployment on that chain, within `maxLag` blocks (20 by default) of the
head, and its index must not move backwards during the read. Otherwise, or if
the indexer fails, the chain implementation runs: the chain stays authoritative,
and an indexer only makes reads faster. Queries that must be authoritative, such
as checking who owns a handle before relinking, omit `indexer`. The ledger knows
the indexer's status protocol, not its application endpoints.

## Conformance

`src/client.test.ts` is the contract every family's client must meet. It covers
every `LedgerClient` and `Session` member, including serving several ledgers,
and runs against a harness each family provides: fake chains and wallets the
suite controls (`src/conformance.harness.ts`; the EVM one is
`src/evm/evm.harness.ts`). It runs again with an unavailable default indexer,
which must change nothing. A family without a harness does not compile.
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
