---
title: Sepolia
description: The Sepolia testnet deployment.
sidebar:
  order: 3
---

| | |
| --- | --- |
| Chain id | `11155111` |
| `IdentityRegistry` | `0x25f29c8c765db2f27d1e2b23987a7b0655c7d640` |
| `HandleEscrow` | `0x57355e1d1bcf61fec9b2e5cad60dcccdddc4d8e5` |

Sepolia is a testnet: its contracts have the testnet
[addresses](/docs/reference/addresses/), the same as Eden's. It runs
libID-contracts v0.17.0, the version these docs describe, and GitHub, X and
Google accept bindings there.

To run a guide against Sepolia, set `RPC_URL` to your Sepolia RPC and:

```sh
export IDENTITY_REGISTRY=0x25f29c8c765db2f27d1e2b23987a7b0655c7d640
export HANDLE_ESCROW=0x57355e1d1bcf61fec9b2e5cad60dcccdddc4d8e5
```
