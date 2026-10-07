# libID

libID is an open identity protocol and library that bridges identities from
OAuth-enabled platforms to verifiable ledgers, including blockchains.

Identity bridging lets **an existing user handle stand in for an onchain
address**, similar to an onchain naming service.

A central motivation is reach: **a user can transact with anyone who already
has an account on a supported platform, even before the recipient links a
wallet**. Once its owner proves control of the account and links a wallet, the
value is automatically claimable without a separate claim action by either the
sender or the recipient.

libID is designed around trust minimization, local-first execution, and
accessibility. Users participate through their browsers without installing
an extension or a separate application. The aim is to make verifiable
identity accessible to developers and, above all, to their users.

The library provides a set of loosely coupled, well-specified protocols with
accessible, API-first implementations. Built from specifications, these
components are designed to be reusable and self-hostable by application
developers, wallet providers, and other integrators.

Beyond identity bridging, libID seeks closer collaboration with online
platforms through integrations that benefit both platforms and their users.
These integrations will **enable users to prove their activity and transact
freely on those platforms**, exercising their essential human right to
transact.

## Identity ceremonies

An identity ceremony is an interactive OAuth proving protocol that lets a
user prove control of an account on a supported platform in a portable
zero-knowledge proof. Users generate these proofs in their own browsers for
verification on a destination ledger.

The outcome of an OAuth proving ceremony is reminiscent of the Fiat-Shamir
transformation: an interactive exchange yields evidence others can verify
independently. OAuth still runs interactively; libID combines zero-knowledge
proofs with platform-signed identity tokens or notarized TLS transcripts to
make the result verifiable without another interaction with the platform.

Initial integrations include Google, X, and GitHub, but the system is designed
to support any OAuth-based platform. It currently supports EVM-compatible
chains.

The initial integrations were chosen for both product relevance and technical
coverage. Google, X, and GitHub each represent a materially different
OAuth/OIDC model. Together they cover most of the variability relevant to
libID and demonstrate that secure identity bridging is feasible across these
models. Their security designs are documented in the
[Google](specs/platform-ceremonies.md#3-google-oidc-ceremony),
[X](specs/platform-ceremonies.md#5-x-ceremony), and
[GitHub](specs/platform-ceremonies.md#6-github-ceremony) ceremony profiles.

Where TLS notarization is required, a notary verifies and signs the sessions.
All current browser proofs complete in under eight seconds in practical runs.

## The popup primitive

libID's identity ceremonies use [`@libid/popup`](ts/packages/popup), a
standalone primitive for cross-site communication and interactive protocol
execution. It can also be used independently to build arbitrary local-first
browser applications, without adopting libID's identity system.

The primitive connects a state machine on site A to a state machine on site B
over a bidirectional channel, and each side learns the authenticated origin
of the other. Each side keeps its own memory and
persistent state behind the browser's same-origin isolation, so A does not
have to trust B entirely. Because site B runs in its own top-level browsing
context rather than an iframe, its storage is first-party storage, not the
partitioned storage browsers give embedded third parties. That is the
isolated, persistent state a browser extension gets, without asking the user
to install anything.

The channel survives what usually breaks cross-site work in browsers: popup
blockers, navigation through third-party pages, documents replacing
themselves, cross-origin isolation severing the opener, and mobile browsers
suspending background tabs. Applications pass their own messages behind one
API and never touch those mechanics.

The package stands on its own. It carries any private, interactive protocol
between two sites, inside or outside libID: interactive proving, state
synchronization such as light clients, a complete in-browser wallet, MPC, or
any local-first browser app that needs isolated state on a second site without
an install.

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
