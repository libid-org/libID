---
title: Addresses
description: libID contract addresses, which networks run which version, and the local stacks.
sidebar:
  order: 3
---

libID deploys every contract through a factory with CREATE3. An address
depends only on the contract's name and the factory, and each environment
has its own factory. So a contract has one address on every testnet and
another on every production network. Upgrades keep a contract at the same
address.

| Contract | Testnet |
| --- | --- |
| `IdentityRegistry` | `0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d` |
| `HandleEscrow` | `0xf3f81c31c889ddf1ec83b91b3dfed601c04f5e50` |
| `CeremonyProofVerifier` | `0x6e4585c4f1ac48a20f49bb61163c466dc4f35004` |
| `NotaryService` | `0xfcf39134654e3542b956ee6e315ca650e6ba3b8c` |
| GitHub platform verifier | `0x13cdf6d5666a42e0eb586809f46ce10e469d11f7` |
| X platform verifier | `0x655be95a91a26b4ade476a8992ee25c98bb774a6` |
| Google platform verifier | `0x355143c93a645ae914b1315eb1b580072207e0f2` |
| `GoogleJwtRoots` | `0x4d9c43d4cf161452b7f66415fa492f4fc42ea583` |
| `LibidFactory` | `0x5294f6c0f1f086f70c9b510ba7990085d5976281` |

Most apps only need `IdentityRegistry`. Your code talks to the others only if it
builds proofs itself.

## Network status

| Network | libID-contracts | Addresses |
| --- | --- | --- |
| [Sepolia](/docs/networks/sepolia/) | v0.19.0 | testnet, above |
| [Eden testnet](/docs/networks/eden/) | v0.19.0 | testnet, above |
| [Ethereum mainnet](/docs/networks/ethereum/) | v0.17.0; v0.19.0 pending | not listed |

These docs describe v0.19.0. The same address on two networks does not by
itself mean the same version: an upgrade on one network does not change the
other.

These addresses come from
[chain-configurations](https://github.com/libid-org/chain-configurations/tree/main/networks),
where `libid-deploy plan --print-addresses` generates them. If this page and
that repository disagree, trust the repository.

## Local stacks

Two ways to run libID on anvil give two different sets of addresses. See
[Test on a local chain](/docs/guides/local-chain/) for both.

`local-dev.toml` in chain-configurations deploys the full stack the way the
public networks do: through a factory with CREATE3, with anvil's first
account as the deployer. On a fresh anvil:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0x155090a3a2dded2fbdf385bac8cffeb3a51a18ae` |
| `HandleEscrow` | `0x1297ddf98efc4d72ce4c5799e057dd61052cfe29` |
| `CeremonyProofVerifier` | `0x145307aaf8dc22fb850aae44aea19628df20e9f6` |
| `NotaryService` | `0x278e8ba43e16e1d757fe77590edb759d85860483` |
| GitHub platform verifier | `0x1aafd47fb1e7c68a1c9afc19d06ccccd958cc4d6` |
| X platform verifier | `0x37be0160c6e2e2e089010d178c7be3ee27602628` |
| Google platform verifier | `0xfcb24d6491120569c91370dd8fa5441adb1d94ee` |
| `GoogleJwtRoots` | `0x6d5bc82c9a8a6a05a9319c9e9d5fc43ff80552ac` |
| `LibidFactory` | `0x13089b18e7fdcdedde55f6b85451561a8b725825` |

The local-chain project the guides' output comes from is different. It
deploys `IdentityRegistry`, a `CeremonyProofVerifier` with test verifiers,
and `HandleEscrow`, with plain CREATE from anvil's first account. The two
your code uses land at:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HandleEscrow` | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |

That project is not published yet.
