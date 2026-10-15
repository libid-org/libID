# Repository map

## In this repository

Besides the protocol specifications under [`specs/`](../specs/), this repo
carries the project website, the browser packages and their development app:

- [`site/`](../site/) — the static project website and Cloudflare deployment
  configuration. Starlight serves the docs at `lib.id/docs/`,
  publishing Markdown from [`docs/pages/`](pages/). Specification sources
  stay in `specs/`.
- [`ts/packages/ceremony`](../ts/packages/ceremony) — **`@libid/ceremony`**, the
  browser identity ceremonies for Google, X and GitHub: OAuth, notarization and
  proving in a CCDP popup, returning proofs for the ledger to verify.
- [`ts/packages/popup`](../ts/packages/popup) — **`@libid/popup`**, one popup
  browsing context and its authenticated connection to the application across
  origins, isolation and document replacement.
- [`ts/packages/ledger`](../ts/packages/ledger) — **`@libid/ledger`**, the
  `LedgerId` contract an application passes to a ceremony.
- [`ts/apps/dev`](../ts/apps/dev) — **`@libid/dev`**, the shared local services and
  browser app for exploring and testing primitives together.

## Repositories

- [`libID`](https://github.com/libid-org/libID) — protocol specifications,
  project overview, the browser packages, and their development app.
- [`libID-rs`](https://github.com/libid-org/libID-rs) — Rust application
  backends and zero-knowledge proof tooling.
- [`libID-contracts`](https://github.com/libid-org/libID-contracts) — Solidity
  contracts for EVM-compatible chains.
- [`libID-circuits`](https://github.com/libid-org/libID-circuits) — the Noir
  circuits; releases ship the compiled circuits + verification keys the
  ceremonies load.
- [`notary`](https://github.com/libid-org/notary) — the notary service
  (MPC-TLS / ProxyMode verifier + attestation signer).
- [`libID-bridge-rs`](https://github.com/libid-org/libID-bridge-rs) — the
  deployable OAuth bridge that publishes ceremony configuration and serves
  the callback document; proving and notarization run in the browser.
- [`chain-configurations`](https://github.com/libid-org/chain-configurations)
  — desired-state deployment files and the `libid-deploy` binary.
- [`keeper`](https://github.com/libid-org/keeper) — permissionlessly keeps
  authoritative off-chain data, initially Google OIDC signing keys, current
  across configured on-chain deployments.
- [`repository-template`](https://github.com/libid-org/repository-template) —
  shared licensing, contribution, and AI-agent defaults for new repositories.
