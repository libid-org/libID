---
title: Sepolia
description: The Sepolia testnet deployment.
sidebar:
  order: 3
---

| | |
| --- | --- |
| Chain id | `11155111` |

Sepolia is a testnet: its contracts have the testnet
[addresses](/docs/reference/addresses/), the same as Eden's. GitHub, X and
Google accept bindings there.

To run a guide against Sepolia, set:

```sh
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export IDENTITY_REGISTRY=0x4e750fb0e1e529d7a57647c0001db96c5ffb6fa1
export HANDLE_ESCROW=0xc7c13a7715858e60d628f867048e0f67fc683dd6
export FROM_BLOCK=11943127
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.
