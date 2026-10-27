---
title: Sepolia
description: The Sepolia testnet deployment.
sidebar:
  order: 3
---

| | |
| --- | --- |
| Chain id | `11155111` |

Sepolia is a testnet. It runs libID-contracts v0.21.0, at the testnet
[addresses](/docs/reference/addresses/), the same as Eden's, except
`HandleEscrow`, which is not deployed yet. GitHub, X and Google accept
bindings there.

To run a guide against Sepolia, set:

```sh
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=11963763
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.

`HANDLE_ESCROW` has no code there yet, so the escrow guides do not run
there. See [Network status](/docs/reference/addresses/#network-status).
