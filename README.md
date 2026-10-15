# [libID](https://lib.id)

![Rust — Ferris the crab](docs/assets/rust-badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-363636?style=flat-square&logo=typescript&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-363636?style=flat-square&logo=solidity&logoColor=white)

**Primitives for new economies built around familiar social identities.**

libID lets applications verify control of existing social accounts and use
them as entry points to payments, ownership, and verifiable incentives across
blockchains without requiring people to create new identities or leave the
platforms they're used to.

## Primitives

| Primitive | What it does | Status |
| --- | --- | --- |
| [Cross-site communication](ts/packages/popup/README.md)<br>[@libid/popup](https://www.npmjs.com/package/@libid/popup) | Run interactive protocols between websites while keeping each site's memory and persistent states isolated. | 🟢 |
| [Identity ceremonies](ts/packages/ceremony/README.md)<br>[@libid/ceremony](https://www.npmjs.com/package/@libid/ceremony) | Prove control of OAuth social accounts with ~10s proof generation, keeping private inputs in the browser.<br>**Supported platforms:** Google, X, and GitHub. | 🟢 |
| [Ledger interactions](ts/packages/ledger/README.md)<br>[@libid/ledger](https://www.npmjs.com/package/@libid/ledger) | Streamline ledger interactions through a common runtime API with heterogeneous chain drivers. | 🚧 |
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
| [notary](https://github.com/libid-org/notary) | TLSNotary-based HTTPS proving client and server. |

## Explore

[Docs](https://lib.id/docs/) · [Specs](specs/libid.md)
