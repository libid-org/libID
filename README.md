# libID

**Primitives for better economic rails over familiar social spaces.**

libID connects social identities to verifiable ledgers so applications can
bring payments and other economic interactions to the platforms people
already use.

Identity bridging is the starting point: a familiar handle can stand in for
an onchain address. The goal is to let people transact with anyone on a
supported platform, even before the recipient connects a wallet, and extend
this to proofs of social activity.

## Primitives

| Primitive | What it does |
| --- | --- |
| [Identity ceremonies](ts/packages/ceremony/README.md) | Prove control of a social account in the browser and return evidence a ledger can verify. |
| [Cross-site communication](ts/packages/popup/README.md) | Run interactive protocols between websites while keeping each site's state isolated. |
| [Ledger identity](ts/packages/ledger/README.md) | Identify the destination ledger and locate its notary service through a shared interface. |

## Explore

- [Design philosophy](docs/design-philosophy.md) — the principles behind the protocols and software.
- [Protocol specifications](specs/libid.md) — the behavior and guarantees implementations share.
- [Development app](ts/apps/dev/README.md) — run identity flows locally.
- [Repository map](docs/repositories.md) — packages, services, contracts, and tooling.
- [Contributing](CONTRIBUTING.md) — project status and contribution terms.

[Website](https://lib.id) · [Documentation](https://lib.id/docs/)
