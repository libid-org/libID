---
title: Security
description: Audit status, admin keys, and how to report a problem.
sidebar:
  order: 3
---

## Audits

The libID contracts, circuits and notary have not been audited.

## Admin keys

The contracts are upgradeable proxies. Their owners can upgrade them and
change which proofs are accepted. On every network, one key owns all of them:

| Network | Owner of every libID contract |
| --- | --- |
| Ethereum mainnet | `0x7e00d33b5c571ca2b2879309C4846Ddd80f4128e` |
| Sepolia, Eden testnet | `0xDAEb247f5A90C53F2D7A80A81f6cb6acB0D8b907` |

On mainnet that key owns `IdentityRegistry`, `HandleEscrow`,
`CeremonyProofVerifier`, `NotaryService`, the three platform verifiers,
`GoogleJwtRoots` and `LibidFactory`. It also owns the `handles.link` name in
ENS and its resolver, `HandleResolver`. Check it yourself:

```sh
cast call 0xbefd300aff7d4a67fb381afe8b3596793d3e9a83 'owner()(address)' \
  --rpc-url https://ethereum-rpc.publicnode.com
```

See [What a binding proves](/docs/concepts/trust/#whom-you-trust) for what
the owner of a contract can do.

## Reporting a problem

Please do not open a public issue for a security problem. Contact the
maintainers of [libid-org](https://github.com/libid-org) privately.
