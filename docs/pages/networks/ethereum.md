---
title: Ethereum
description: The Ethereum mainnet deployment.
sidebar:
  order: 1
---

| | |
| --- | --- |
| Chain id | `1` |

Ethereum mainnet is libID's production network. Its contracts have the
production [addresses](/docs/reference/addresses/). GitHub, X and Google
accept bindings there.

An X or GitHub binding pays the notary fee twice, once for each
attestation; a Google binding pays none. Read the current amount with
`quoteBind` instead of hard-coding it.

To run a guide against mainnet, set:

```sh
export RPC_URL=https://ethereum-rpc.publicnode.com
export IDENTITY_REGISTRY=0xbefd300aff7d4a67fb381afe8b3596793d3e9a83
export HANDLE_ESCROW=0x17a244e23ef1f12071298a1862194fea3d00bbf7
export FROM_BLOCK=26122774
```

`FROM_BLOCK` is the block `IdentityRegistry` was deployed in. The
[events guide](/docs/guides/events/) reads from there.
