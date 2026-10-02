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
| `IdentityRegistry` | `0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366` |
| `HandleEscrow` | `0xf7e3ad279f913ffe2ef74614e3046c15cbdabb9a` |

Eden runs libID-contracts v0.15.0, the version these docs describe. GitHub,
X and Google accept bindings there. No identity is bound on this registry
yet, so lookups return `null` until someone binds one. Use the
[local chain](/docs/guides/local-chain/) for known test data.

To run a guide against Eden, set:

```sh
export RPC_URL=https://ev-reth-eden-testnet.binarybuilders.services:8545
export IDENTITY_REGISTRY=0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366
export HANDLE_ESCROW=0xf7e3ad279f913ffe2ef74614e3046c15cbdabb9a
```

Eden's chain id is larger than `2^31`, so ENS libraries such as viem cannot
compute a coin type for it. `handles.link` names do not resolve for Eden.
