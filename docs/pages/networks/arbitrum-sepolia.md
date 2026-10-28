---
title: Arbitrum Sepolia
description: The Arbitrum Sepolia testnet deployment.
sidebar:
  order: 4
---

| | |
| --- | --- |
| Chain id | `421614` |

Arbitrum Sepolia is a testnet. It runs libID-contracts v0.21.0, at the
testnet [addresses](/docs/reference/addresses/), the same as Sepolia's.
GitHub, X and Google accept bindings there.

To run a guide against Arbitrum Sepolia, set:

```sh
export RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=323452844
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.
