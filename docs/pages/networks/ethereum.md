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
production [addresses](/docs/reference/addresses/). It runs libID-contracts
v0.17.0, the version these docs describe, and GitHub, X and Google accept
bindings there.

An X or GitHub binding pays the notary fee twice, once for each
attestation; a Google binding pays none. Read the current amount with
`quoteBind` instead of hard-coding it.

To run a guide against mainnet, set `RPC_URL` to your Ethereum RPC and:

```sh
export IDENTITY_REGISTRY=0xbefd300aff7d4a67fb381afe8b3596793d3e9a83
export HANDLE_ESCROW=0x17a244e23ef1f12071298a1862194fea3d00bbf7
```
