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
carries the browser claim library and the integration harness:

- [`site/`](site/) — the static project website and Cloudflare deployment
  configuration. Starlight serves the docs at `lib.id/docs/`,
  publishing Markdown from [`docs/pages/`](docs/pages/). Specification sources
  stay in `specs/`.
- [`ts/packages/claim`](ts/packages/claim) — **`@libid/claim`**, the browser
  library for the OAuth handle-claim flows. GitHub (backend-driven MPC-TLS),
  X (in-browser TLSNotary ProxyMode + a Noir/UltraHonk proof), and Google
  (a SNARK over the OIDC id_token). Each flow opens the consent popup,
  proves control of the account, and returns bind-ready proof bytes made
  out to the holder address; encoding/submission/resolution helpers come
  from [`@libid/contracts`](https://www.npmjs.com/package/@libid/contracts).
  Framework-free (no React), wallet-product-free (a unit test enforces it).
- [`ts/apps/demo`](ts/apps/demo) — a buttons-only vite demo consuming the
  library: connect a wallet (or a dev key), claim a handle, resolve it.
- [`harness/`](harness) — the integration harness: a docker-compose stack
  (anvil + deterministic contract deploy + released notary and
  libid-server-rs images) plus asset staging and one `boot.sh` for a
  real, manual end-to-end claim. See [`harness/README.md`](harness/README.md).

## Repositories

- [`libID`](https://github.com/libid-org/libID) — protocol specifications,
  project overview, the `@libid/claim` browser library, and the
  integration harness.
- [`libID-rs`](https://github.com/libid-org/libID-rs) — Rust application
  backends and zero-knowledge proof tooling.
- [`libID-contracts`](https://github.com/libid-org/libID-contracts) — Solidity
  contracts for EVM-compatible chains.
- [`libID-circuits`](https://github.com/libid-org/libID-circuits) — the Noir
  circuits; releases ship the compiled circuits + verification keys the
  claim flows load.
- [`notary`](https://github.com/libid-org/notary) — the notary service
  (MPC-TLS / ProxyMode verifier + attestation signer).
- [`libID-server-rs`](https://github.com/libid-org/libID-server-rs) — the
  deployable libID server for GitHub OAuth and MPC-TLS proof generation.
- [`chain-configurations`](https://github.com/libid-org/chain-configurations)
  — desired-state deployment files and the `libid-deploy` binary.
- [`keeper`](https://github.com/libid-org/keeper) — permissionlessly keeps
  authoritative off-chain data, initially Google OIDC signing keys, current
  across configured on-chain deployments.
- [`repository-template`](https://github.com/libid-org/repository-template) —
  shared licensing, contribution, and AI-agent defaults for new repositories.
