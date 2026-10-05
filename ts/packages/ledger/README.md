# @libid/ledger

Shared `LedgerId` contract for application code: `hash()` and `notaryAddress()`.
See the [identity contract](docs/identity.md).

**No real ledger definitions are implemented yet.** Adding one requires its
canonical Chain Profile hash vectors and notary-address checks. Ceremony stays
chain agnostic; Prover has no ledger dependency.

## Fixtures

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts). A synthetic
identity establishes no real ledger conformance, and a local fixture can change
the notary address without changing its hash.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build` and
`pnpm --filter @libid/ledger typecheck`.
