---
title: Sepolia
description: The Sepolia testnet deployment.
sidebar:
  order: 3
---

| | |
| --- | --- |
| Chain id | `11155111` |

Sepolia is a testnet. It runs libID-contracts v0.19.0, at the testnet
[addresses](/docs/reference/addresses/), the same as Eden's. GitHub, X and
Google accept bindings there.

To run a guide against Sepolia, set:

```sh
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export IDENTITY_REGISTRY=0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d
export HANDLE_ESCROW=0xf3f81c31c889ddf1ec83b91b3dfed601c04f5e50
export FROM_BLOCK=11963763
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.
