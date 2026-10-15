# @libid/ledger

Give an identity ceremony a destination ledger and a route to its notary.

The same social account can be used with different networks. This primitive
lets an application identify the intended ledger so a ceremony can bind the
user's authorization to that destination without depending on a particular
chain's client library.

**Current status:** the package defines the shared interface; no production
ledger definitions are implemented yet.

## What it provides

- `hash()` identifies the ledger according to its Chain Profile.
- `notaryAddress()` locates the notary service used by ceremonies that need
  TLS evidence; the ledger verifier determines which signing keys to trust.

The [identity guide](docs/identity.md) covers the interface, development
fixtures, and requirements for adding a ledger definition. Wallet operations
and transaction submission belong to the application.

## Fixtures

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts). A synthetic
identity establishes no real ledger conformance, and a local fixture can change
the notary address without changing its hash.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build` and
`pnpm --filter @libid/ledger typecheck`.
