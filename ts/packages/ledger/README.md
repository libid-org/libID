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

Only the `eip155` namespace is implemented. Ceremony stays chain agnostic;
Prover has no ledger dependency.

## Chain access

`@libid/ledger/client` runs reads and writes without knowing what they mean.
The layer above describes them with one function per namespace, so adding a
namespace fails to compile until every query and command implements it. Each
namespace's own types (`Reader`, `Tx`, `Provider`) live in its module, such as
`@libid/ledger/eip155`; the client entry point stays namespace-agnostic:

```ts
import { connect, type Query } from '@libid/ledger/client'

const resolveHandle: Query<[platform: `0x${string}`, handle: string], `0x${string}`> = {
  eip155: (read, platform, handle) =>
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

- `read` pins every action in a query to one block, so the query sees one
  consistent state.
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

The catalog and client take no RPC defaults; consumers supply endpoints.

## Adding a namespace

1. Add it to `Namespace` in `src/index.ts`, and give `defineLedger` its Chain
   Profile hash and address check from `src/<namespace>/chain.ts`.
2. Create `src/<namespace>/index.ts` with the namespace's `Reader`, `Tx` and
   `Provider` types, and `src/<namespace>/client.ts` implementing
   `LedgerClient`. Export `./<namespace>` from `package.json`.
3. Add one entry to `Namespaces` in `src/client.ts` and dispatch to the new
   driver in `connect`.

The compiler then flags the `connect` dispatch and every `Query` and `Command`
without the new namespace, in this package and in its consumers. Existing
namespace modules and namespace-agnostic code do not change.

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
