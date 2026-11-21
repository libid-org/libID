---
title: Eden testnet
description: The Eden testnet deployment.
sidebar:
  order: 2
---

| | |
| --- | --- |
| Chain id | `3735928814` |

Eden is a testnet. It runs libID-contracts v0.21.0, at the testnet
[addresses](/docs/reference/addresses/), the same as Sepolia's. GitHub, X and
Google accept bindings there.

To run a guide against Eden, set `RPC_URL` to an Eden RPC endpoint, and:

```sh
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=291663483
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.

Eden's chain id is larger than `2^31`, so ENS libraries such as viem cannot
compute its coin type. Pass it by hand to resolve a `handles.link` name for
Eden; see [ENS names](/docs/ens/names/#testnets).
