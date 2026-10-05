---
title: Introduction
description: Every social account is already a multichain identity.
---

libID lets an address prove it holds a GitHub, X or Google account. The proof is
checked on chain, and the result is stored in the `IdentityRegistry` contract.
Any app or contract can then ask who holds `@octocat`, or which identities
an address holds, by reading the chain. There is no libID server to ask. You still
rely on the platforms, the notary and the contract owners; see
[What a binding proves](/docs/concepts/trust/).

With that you can:

- show a name instead of an address,
- send funds to a handle, even before anyone holds it,
- let only verified accounts call a contract,
- resolve a handle as an ENS name, such as `octocat.github.handles.link`,
  for bindings on Ethereum mainnet.

## Start here

- [Quickstart](/docs/get-started/quickstart/): read your first binding in a
  few minutes.
- [Test on a local chain](/docs/guides/local-chain/): run the libID contracts
  on your machine.

## Guides

- [Look up a wallet](/docs/guides/lookup-wallet/)
- [Resolve a handle](/docs/guides/resolve-handle/)
- [Gate a contract](/docs/guides/gate-contract/)
- [Send funds to a handle](/docs/guides/pay-a-handle/)
- [Listen to events](/docs/guides/events/)
- [ENS names](/docs/ens/names/)

## Before you build on it

- [What a binding proves](/docs/concepts/trust/), and whom you trust for it.
- [Security](/docs/resources/security/): the contracts have not been audited.
- [Networks](/docs/networks/ethereum/): what is deployed where.
