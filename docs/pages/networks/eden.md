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

Eden is a testnet: its contracts have the testnet
[addresses](/docs/reference/addresses/), the same as Sepolia's. GitHub, X
and Google accept bindings there.

To run a guide against Eden, set:

```sh
export RPC_URL=https://ev-reth-eden-testnet.binarybuilders.services:8545
export IDENTITY_REGISTRY=0x4e750fb0e1e529d7a57647c0001db96c5ffb6fa1
export HANDLE_ESCROW=0xc7c13a7715858e60d628f867048e0f67fc683dd6
export FROM_BLOCK=289169815
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.

Eden's chain id is larger than `2^31`, so ENS libraries such as viem cannot
compute a coin type for it. `handles.link` names do not resolve for Eden.
