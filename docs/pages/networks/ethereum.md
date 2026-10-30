---
title: Ethereum
description: The Ethereum mainnet deployment.
sidebar:
  order: 1
---

| | |
| --- | --- |
| Chain id | `1` |

Ethereum mainnet is libID's production network. It runs libID-contracts
v0.21.0, at the mainnet [addresses](/docs/reference/addresses/).

To run a guide against mainnet, set:

```sh
export RPC_URL=https://mainnet.gateway.tenderly.co
export IDENTITY_REGISTRY=0xF39343fEbdA25cAa8C3861954E33F8a0189D4FDA
export HANDLE_ESCROW=0xf2731aB2c9451A9191e0Ef64D7fd5352068eB1b5
export FROM_BLOCK=26287671
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.

The guides' examples, such as `testyakly`, are bound on Sepolia, not here.

An X or GitHub binding pays the notary fee twice, once for each
attestation; a Google binding pays none. Read the current amount with
`quoteBind` instead of hard-coding it.
