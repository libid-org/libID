---
title: Addresses
description: libID contract addresses on the testnets and on a local chain.
sidebar:
  order: 3
---

libID deploys every contract through a factory with CREATE3. An address
depends only on the contract's name and the factory, and each environment
has its own factory. So a contract has one address on every testnet and
another on every production network. Upgrades keep a contract at the same
address. v0.18 is a new deployment, with new addresses.

| Contract | Testnet |
| --- | --- |
| `IdentityRegistry` | `0x4e750fb0e1e529d7a57647c0001db96c5ffb6fa1` |
| `HandleEscrow` | `0xc7c13a7715858e60d628f867048e0f67fc683dd6` |
| `CeremonyProofVerifier` | `0x00ad3331317e6c1b9599472bec9bba321bd38137` |
| `NotaryService` | `0xfcf39134654e3542b956ee6e315ca650e6ba3b8c` |
| GitHub platform verifier | `0x0e957083ea529d1eeb6e49e7742e94a7173380a8` |
| X platform verifier | `0x4b395ca8dd2642bd65ddd9b1da518ff8cb7a9c84` |
| Google platform verifier | `0x141d728ce8d21d5eeda2be5a4a93cd62e174b55b` |
| `GoogleJwtRoots` | `0x4d9c43d4cf161452b7f66415fa492f4fc42ea583` |
| `LibidFactory` | `0x5294f6c0f1f086f70c9b510ba7990085d5976281` |

The testnets are [Sepolia](/docs/networks/sepolia/) and
[Eden testnet](/docs/networks/eden/). Both run libID-contracts v0.18.1, the
version these docs describe. The same address on two networks does not by
itself mean the same version: an upgrade on one network does not change the
other.

Production is [Ethereum mainnet](/docs/networks/ethereum/). v0.18 is not
deployed there yet, so this page lists no production addresses.

These addresses come from
[chain-configurations](https://github.com/libid-org/chain-configurations/tree/main/networks),
where `libid-deploy plan --print-addresses` generates them. If this page and
that repository disagree, trust the repository.

Most apps only need `IdentityRegistry`. Your code talks to the others only if it
builds proofs itself.

## Local stacks

Two ways to run libID on anvil give two different sets of addresses. See
[Test on a local chain](/docs/guides/local-chain/) for both.

`local-dev.toml` in chain-configurations deploys the full stack the way the
public networks do: through a factory with CREATE3, with anvil's first
account as the deployer. On a fresh anvil:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0x31874a585aab1f98121f14f4b2af68a93eaaa9a5` |
| `HandleEscrow` | `0x520996cdbccfffd952a5134dab146b6fac7b103c` |
| `CeremonyProofVerifier` | `0x7eb419023544487e5b4a61d6db043a8e29c4df4e` |
| `NotaryService` | `0x278e8ba43e16e1d757fe77590edb759d85860483` |
| GitHub platform verifier | `0x4dfff81322459ca460e3ddede2b8dcb33bf10745` |
| X platform verifier | `0xcced9e8428f4043d00d4d5dfc293d864bb2bc204` |
| Google platform verifier | `0x5de9d5f806d872315bfdfde5b5eb8f97ebcb743d` |
| `GoogleJwtRoots` | `0x6d5bc82c9a8a6a05a9319c9e9d5fc43ff80552ac` |
| `LibidFactory` | `0x13089b18e7fdcdedde55f6b85451561a8b725825` |

The local-chain project the guides' output comes from is different. It
deploys `IdentityRegistry`, a `CeremonyProofVerifier` with test verifiers,
and `HandleEscrow`, with plain CREATE from anvil's first account. The two
your code uses land at:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HandleEscrow` | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` |

That project is not published yet.
