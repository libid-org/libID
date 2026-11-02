# @libid/ledger

[![Coverage](https://img.shields.io/badge/coverage-N%2FA-lightgrey)](#use-and-develop)

Streamline ledger interactions through a common runtime API with heterogeneous
chain drivers.

**Specification:** [Chain profiles](https://lib.id/specs/chain-profiles/).

The goal is to let applications work with different ledgers through one API,
with each driver handling the details of its chain. Identity
ceremonies are one use: they need to locate a ledger's notary service.

## How it works

- `notaryAddress()` locates the notary service used by ceremonies that need
  TLS evidence; the ledger verifier determines which signing keys to trust.

Wallet operations and transaction submission belong to the application.

## Use and develop

- [Identity guide](docs/identity.md) — interface, development fixtures, and ledger definitions.

Run from this package:

```sh
pnpm build
pnpm typecheck
```

Tests and applications define their own synthetic `LedgerId`s; ceremony's tests
use [`src/testing/ledgers.ts`](../ceremony/src/testing/ledgers.ts). A synthetic
ledger establishes no real ledger conformance.
