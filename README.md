# libID

![Rust — Ferris the crab](docs/assets/rust-badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-363636?logo=solidity&logoColor=white)

**Primitives for better economic rails over familiar social spaces.**

libID connects social identities to verifiable ledgers so applications can
bring payments and other economic interactions to the platforms people
already use.

## Primitives

| Primitive | What it does | Status |
| --- | --- | --- |
| [Cross-site communication](ts/packages/popup/README.md)<br>`@libid/popup` | Run interactive protocols between websites while keeping each site's memory and persistent states isolated. | 🟢 |
| [Identity ceremonies](ts/packages/ceremony/README.md)<br>`@libid/ceremony` | Prove custody of OAuth social accounts with ~10s proof generation, keeping private inputs in the browser.<br>**Currently supported platforms:** Google, X, and GitHub. | 🟢 |
| [Ledger interactions](ts/packages/ledger/README.md)<br>`@libid/ledger` | Streamline ledger interactions through a common runtime API with heterogeneous chain drivers. | 🚧 |
| Key vault<br>`@libid/vault` | Store private keys securely in the browser using IndexedDB. | 🗓️ |
| Browser wallet<br>`@libid/wallet` | Run a wallet entirely in the browser, independent of ledger choice, with pluggable cryptography and no extensions. | 🗓️ |
| React ceremony components<br>`@libid/ceremonies-react` | Reusable React components for `@libid/ceremony`. | 🗓️ |
| React wallet components<br>`@libid/wallet-react` | Reusable React components for `@libid/wallet`. | 🗓️ |

## Repositories

| Repository | Purpose |
| --- | --- |
| [libID-rs](https://github.com/libid-org/libID-rs) | Rust backends and proof tooling. |
| [libID-contracts](https://github.com/libid-org/libID-contracts) | Smart contracts for EVM chains. |
| [libID-circuits](https://github.com/libid-org/libID-circuits) | Zero-knowledge circuits and verification keys. |
| [libID-bridge-rs](https://github.com/libid-org/libID-bridge-rs) | OAuth bridge for identity ceremonies. |
| [notary](https://github.com/libid-org/notary) | Notarized evidence of interactions with social platforms. |

See the [repository map](docs/repositories.md) for the full directory and package layout.

## Explore

- [Design philosophy](docs/design-philosophy.md) — the principles behind the protocols and software.
- [Protocol specifications](specs/libid.md) — the behavior and guarantees implementations share.
- [Development app](ts/apps/dev/README.md) — explore and test libID primitives locally.
- [Contributing](CONTRIBUTING.md) — project status and contribution terms.

[Website](https://lib.id) · [Documentation](https://lib.id/docs/)
