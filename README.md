# libID

[![project libID](https://img.shields.io/badge/project-libID-b57614?style=flat-square&labelColor=363636)](https://lib.id)
[![🪾 made by GroundedSystems](https://img.shields.io/badge/%F0%9F%AA%BE%20made%20by-GroundedSystems-000000?style=flat-square&labelColor=363636)](https://grndd.systems)

![Rust — Ferris the crab](docs/assets/rust-badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-363636?style=flat-square&logo=typescript&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-363636?style=flat-square&logo=solidity&logoColor=white)

**Primitives and protocols for new economies built around familiar social identities.**

libID lets applications verify control of existing social accounts and use
them as entry points to payments, ownership, and programmable incentives
across verifiable ledgers without requiring users to create new identities
or leave the platforms they're used to.

## Primitives

| Primitive | Package | What it does | Status |
| --- | --- | --- | --- |
| [Cross-site communication](ts/packages/popup/README.md) | [@libid/popup](https://www.npmjs.com/package/@libid/popup) | Run interactive protocols between websites while keeping each site's memory and persistent states isolated. | 🟢 |
| [Identity ceremonies](ts/packages/ceremony/README.md) | [@libid/ceremony](https://www.npmjs.com/package/@libid/ceremony) | Prove control of *any* OAuth/OIDC social account in the user's browser, with their identity data never leaving their device.<br>**Supported platforms:** Google, X, and GitHub. Extend to more platforms with a few prompts. | 🟢 |
| [Ledger interactions](ts/packages/ledger/README.md) | [@libid/ledger](https://www.npmjs.com/package/@libid/ledger) | Streamline ledger interactions through a common runtime API with heterogeneous chain drivers. | 🚧 |
| Key vault | `@libid/vault` | Store private keys securely in the browser using IndexedDB. | 🗓️ |
| Browser wallet | `@libid/wallet` | Run a wallet entirely in the browser, independent of ledger choice, with pluggable cryptography and no extensions. | 🗓️ |
| React ceremony components | `@libid/ceremonies-react` | Reusable React components for `@libid/ceremony`. | 🗓️ |
| React wallet components | `@libid/wallet-react` | Reusable React components for `@libid/wallet`. | 🗓️ |

## Repositories

| Repository | Purpose |
| --- | --- |
| [libID-rs](https://github.com/libid-org/libID-rs) | Rust backends and proof tooling. |
| [libID-contracts](https://github.com/libid-org/libID-contracts) | Smart contracts for EVM chains. |
| [libID-circuits](https://github.com/libid-org/libID-circuits) | Zero-knowledge circuits and verification keys. |
| [libID-bridge-rs](https://github.com/libid-org/libID-bridge-rs) | OAuth bridge for identity ceremonies. |
| [notary](https://github.com/libid-org/notary) | TLSNotary-based HTTPS proving client and server. |

## Security

Found a vulnerability? Email [security@lib.id](mailto:security@lib.id) and
keep it out of public issues. See [SECURITY.md](SECURITY.md).

## Explore

[Docs](https://lib.id/docs/) · [Specs](https://lib.id/specs/)
