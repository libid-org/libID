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
| `IdentityNames` | `0xe78b53a183dd51763df44beb2500ddab9bb0329e` |
| `HandleEscrow` | not deployed |

Eden runs an older version of `IdentityNames` than these docs describe.
`resolveHandle`, `resolveId`, `resolvePair`, `primaryOf`, `reverseOf`,
`byHandle` and `byId` work. `nodeOf`, `handleHashOf`, `rulesOf`,
`acceptsBindings`, `accountCount` and `accountsOf` do not exist there yet, so
the escrow cannot be deployed against it.

Eden's chain id is larger than `2^31`, so ENS libraries such as viem cannot
compute a coin type for it. `handles.link` names do not resolve for Eden.

Until Eden is upgraded, use [a local chain](/docs/guides/local-chain/) to run
every guide.
