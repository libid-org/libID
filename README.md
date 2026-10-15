# libID

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

**Primitives for better economic rails over familiar social spaces.**

libID connects social identities to verifiable ledgers so applications can
bring payments and other economic interactions to the platforms people
already use.

Identity bridging is the starting point: a familiar handle can stand in for
an onchain address. The goal is to let people transact with anyone on a
supported platform, even before the recipient connects a wallet, and extend
this to proofs of social activity.

## Primitives

| Primitive | What it does | Status |
| --- | --- | --- |
| [Cross-site communication](ts/packages/popup/README.md)<br>`@libid/popup` | Run interactive protocols between websites while keeping each site's state isolated. | 🟢 Implemented |
| [Identity ceremonies](ts/packages/ceremony/README.md)<br>`@libid/ceremony` | Prove control of a social account in the browser and return evidence a ledger can verify. | 🟢 Implemented |
| [Ledger interactions](ts/packages/ledger/README.md)<br>`@libid/ledger` | Streamline ledger interactions through a common runtime API that is agnostic to the underlying chain. | 🚧 In development |

## Explore

- [Design philosophy](docs/design-philosophy.md) — the principles behind the protocols and software.
- [Protocol specifications](specs/libid.md) — the behavior and guarantees implementations share.
- [Development app](ts/apps/dev/README.md) — run identity flows locally.
- [Repository map](docs/repositories.md) — packages, services, contracts, and tooling.
- [Contributing](CONTRIBUTING.md) — project status and contribution terms.

[Website](https://lib.id) · [Documentation](https://lib.id/docs/)
