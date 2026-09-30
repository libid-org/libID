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
