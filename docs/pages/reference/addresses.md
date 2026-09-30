---
title: Addresses
description: libID contract addresses. They are the same on every network.
sidebar:
  order: 3
---

libID deploys every contract through one factory with CREATE3. An address
depends only on the contract's name, so each contract has the same address
on every network where it is deployed.

| Contract | Address |
| --- | --- |
| `IdentityNames` | `0xe78b53a183dd51763df44beb2500ddab9bb0329e` |
| `CeremonyProofVerifier` | `0x76bdc18f21c2db0ff796c7cc50348528b2899275` |
| `NotaryService` | `0xbb5871167b0128939cab6850877981421e8dcbf5` |
| GitHub platform verifier | `0xac878389da7a1b58826182da0d8b4cae5e6e4178` |
| X platform verifier | `0xcfc880f62f2744dc000687edf47a98b585d9eb35` |
| Google platform verifier | `0xf3d537022362d187715b28bc547f8b2532e6d0cf` |
| `GoogleJwtRoots` | `0xb7a2ce28e71dbb9c877d2b5a48de33b5f0e6838d` |
| `LibidFactory` | `0xa92244c3f4462aad08bd1a33c3940b9b936321ad` |

`HandleEscrow` has no address yet.

The same address on a network does not mean the same version. Check
[Networks](/docs/networks/eden/) for what each network runs.

These addresses come from
[chain-configurations](https://github.com/libid-org/chain-configurations/tree/main/networks),
where `libid-deploy plan --print-addresses` generates them. If this page and
that repository disagree, trust the repository.

Most apps only need `IdentityNames`. Your code talks to the others only if it
builds proofs itself.
