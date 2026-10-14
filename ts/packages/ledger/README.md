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

Only the `eip155` namespace is implemented. Ceremony stays chain agnostic;
Prover has no ledger dependency.

## Fixtures

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts), whose chain
identifiers use the `test` namespace. A synthetic identity establishes no real
ledger conformance, and a local fixture can change the notary address without
changing its hash.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build`,
`pnpm --filter @libid/ledger typecheck`, and `pnpm --filter @libid/ledger test`.
