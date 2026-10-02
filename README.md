# libID

libID is a trust-minimized identity system that bridges identities from
OAuth-enabled platforms to blockchains. Initial integrations include Google,
X, and GitHub, but the system is designed to support any OAuth-based platform.
It currently supports EVM-compatible chains.

The initial integrations were chosen for both product relevance and technical
coverage. Google, X, and GitHub each represent a materially different
OAuth/OIDC model. Together they cover most of the variability relevant to
libID and demonstrate that secure identity bridging is feasible across these
models. Their security designs are documented in the
[Google](specs/platform-ceremonies.md#3-google-oidc-ceremony),
[X](specs/platform-ceremonies.md#5-x-ceremony), and
[GitHub](specs/platform-ceremonies.md#6-github-ceremony) ceremony profiles.

Identity bridging lets **an existing user handle stand in for an onchain
address**, similar to an onchain naming service.

A central motivation is reach: **a user can transact with anyone who already
has an account on a supported platform, even before the recipient links a
wallet**. Once its owner proves control of the account and links a wallet, the
value is automatically claimable without a separate claim action by either the
sender or the recipient.

The core is built bottom-up using a spec-driven approach and includes the tools
needed to make the system accessible, self-hostable, and reusable by
application developers, wallet providers, and other integrators without
introducing a central point of failure.

Our focus is browser-side zero-knowledge proving and TLS notarization: users
generate proofs in their own browsers, while the notary verifies and signs the
notarized sessions. All current browser proofs complete in under eight seconds
in practical runs.

Beyond identity bridging, libID seeks closer collaboration with online
platforms through integrations that benefit both platforms and their users.
These integrations will **enable users to prove their activity and transact
freely on those platforms**, exercising their essential human right to
transact.

## In this repository

Besides the protocol specifications under [`specs/`](specs/), this repo
carries the project website, the browser packages and their development app:

- [`site/`](site/) — the static project website and Cloudflare deployment
  configuration. Starlight serves the docs at `lib.id/docs/`,
  publishing Markdown from [`docs/pages/`](docs/pages/). Specification sources
  stay in `specs/`.
- [`ts/packages/ceremony`](ts/packages/ceremony) — **`@libid/ceremony`**, the
  browser identity ceremonies for Google, X and GitHub: OAuth, notarization and
  proving in a CCDP popup, returning proofs for the ledger to verify.
- [`ts/packages/popup`](ts/packages/popup) — **`@libid/popup`**, one popup
  browsing context and its authenticated connection to the application across
  origins, isolation and document replacement.
- [`ts/packages/ledger`](ts/packages/ledger) — **`@libid/ledger`**, the
  `LedgerId` contract an application passes to a ceremony.
- [`ts/apps/dev`](ts/apps/dev) — **`@libid/dev`**, the shared local services and
  browser app for manual ceremony testing.

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
