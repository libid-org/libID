# @libid/ledger

[![Coverage](https://img.shields.io/badge/coverage-N%2FA-lightgrey)](#checks)

Streamline ledger interactions through a common runtime API with heterogeneous
chain drivers.

The goal is to let applications work with different ledgers through one API,
with each driver handling the details of its chain. Identity
ceremonies are one use: they need to identify a destination ledger and locate
its notary service.

## What it provides

- `hash()` identifies the ledger according to its Chain Profile.
- `notaryAddress()` locates the notary service used by ceremonies that need
  TLS evidence; the ledger verifier determines which signing keys to trust.

The [identity guide](docs/identity.md) covers the interface, development
fixtures, and requirements for adding a ledger definition. Wallet
operations and transaction submission belong to the application.

## Fixtures

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts). A synthetic
identity establishes no real ledger conformance, and a local fixture can change
the notary address without changing its hash.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build` and
`pnpm --filter @libid/ledger typecheck`.
