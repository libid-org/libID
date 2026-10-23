---
title: Eden testnet
description: The Eden testnet deployment.
sidebar:
  order: 2
---

| | |
| --- | --- |
| Chain id | `3735928814` |
| RPC | `https://ev-reth-eden-testnet.binarybuilders.services:8545` |

Eden is a testnet. It runs libID-contracts v0.19.0, at the testnet
[addresses](/docs/reference/addresses/), the same as Sepolia's. GitHub, X
and Google accept bindings there.

To run a guide against Eden, set:

```sh
export RPC_URL=https://ev-reth-eden-testnet.binarybuilders.services:8545
export IDENTITY_REGISTRY=0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d
export HANDLE_ESCROW=0xf3f81c31c889ddf1ec83b91b3dfed601c04f5e50
export FROM_BLOCK=291663483
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.

Eden's chain id is larger than `2^31`, so ENS libraries such as viem cannot
compute a coin type for it. `handles.link` names do not resolve for Eden.
