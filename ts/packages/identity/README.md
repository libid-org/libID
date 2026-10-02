# @libid/identity

libID identities across every ledger a client serves: which accounts are bound
to a wallet, who owns an account or handle, and binding new ones. It builds on
`@libid/ledger`, which owns the catalog, chain access and the libID indexer
protocol; this package owns the identity registry's meaning.

```ts
import { createIdentityClient } from '@libid/identity'

// Every pinned libID ledger, read through the connected wallet.
const identity = createIdentityClient()
```

With no options, the client serves every pinned ledger (`Ledgers`) that has the
identity registry (`identityRegistry`). It reads each through the connected wallet
while it is on that ledger's chain, and charges no fee. libID pins no RPCs; an
entry's `rpc` enables reads before a wallet connects and lets wallets be offered
the chain. One list of entries
changes that: an entry for a pinned ledger configures it, and an entry for any
other ledger adds it.

```ts
import { Ledgers } from '@libid/ledger'

const identity = createIdentityClient({
  indexer: 'https://testnet.names.lib.id',
  ledgers: [
    // An integrator fee, in the ledger's native units. libID defines none.
    { ledger: Ledgers.EdenTestnet, fee: { amount: 10n ** 15n, recipient: '0x…' } },
    // A ledger outside the catalog.
    { ledger: anvil, rpc: 'http://127.0.0.1:8545', indexer: false },
  ],
})
```

- An entry may set `rpc` and `explorer`, reach the ledger through another ledger
  `client` instead, replace the names `indexer` origin, or turn it off with
  `indexer: false`. It never changes a pinned ledger's deployments.
- `exclude: [Ledgers.EdenTestnet]` leaves a pinned ledger out.
- On a ledger with a names indexer, identity lists come from the indexer; a stale
  or unavailable indexer fails the read rather than falling back to the chain.
- Every ledger must have an `identityRegistry` deployment (`IdentityLedger`), which
  the compiler and `createIdentityClient` both check.
- The client exposes the ledgers it serves, `ledger(chain)` for runtime lookup,
  `walletRequirements` for wallet connectors, and `fee(ledger)`.

Identity reads, readiness checks and durable bindings build on this client in
follow-up changes.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/identity build`,
`pnpm --filter @libid/identity typecheck`, and `pnpm --filter @libid/identity test`.
