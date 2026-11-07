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
[addresses](/docs/reference/addresses/), the same as Eden's. GitHub, X and
Google accept bindings there. The guides run against Sepolia.

To run a guide against Sepolia, set:

```sh
export RPC_URL=https://sepolia.gateway.tenderly.co
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=11963763
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there. Some free RPCs drop
logs that old; this one keeps them.

The guides use the GitHub handle `testyakly`, bound there to
`0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c`. That address also holds two
private identities on other platforms.

Names resolve as `<handle>.<platform>.testnet.handles.link` through ENS on
Sepolia; see [ENS names](/docs/ens/names/#testnets).
