---
title: Addresses
description: libID contract addresses, one set for production and one for testnets.
sidebar:
  order: 3
---

libID deploys every contract through a factory with CREATE3. An address
depends only on the contract's name and the factory, and each environment
has its own factory. So a contract has one address on every production
network and another on every testnet. Within an environment these addresses
never change: contract updates are upgrades at the same address.

| Contract | Production | Testnet |
| --- | --- | --- |
| `IdentityRegistry` | `0xbefd300aff7d4a67fb381afe8b3596793d3e9a83` | `0x25f29c8c765db2f27d1e2b23987a7b0655c7d640` |
| `HandleEscrow` | `0x17a244e23ef1f12071298a1862194fea3d00bbf7` | `0x57355e1d1bcf61fec9b2e5cad60dcccdddc4d8e5` |
| `CeremonyProofVerifier` | `0x36e6d6cf465cb9f0615ceb0fc37ef30927dac66e` | `0xa795b14a2e09daf273bc6971058b0462c7d6be42` |
| `NotaryService` | `0x2feee7c87bec78853afc223135735d4786e75177` | `0xa773ec5e7500d1c87827ab1b899bbd992c1b5931` |
| GitHub platform verifier | `0xdd7d34f2302bc2ccac36bdcec5fdafe0ca91f888` | `0xb5fdf35eedf7c849f3d1e41675d8b8a41487e248` |
| X platform verifier | `0x61d79debf1b7e512ae8b305ba76c6f82f4609142` | `0x9f655c2fe778260d90f3202d97da0a46510aa3d0` |
| Google platform verifier | `0x727f4a1c9040a94ca27f74667c70d1c2951a0b5a` | `0x5cfb807545e0e2ce4d7dac7d97ab0583e3fbe1c6` |
| `GoogleJwtRoots` | `0x1f3d9b49efde0c12ed2ffeab67165ebe0c97517a` | `0x8a14a5dda7662f88a5448b9b8b2ca9f1d5742904` |
| `LibidFactory` | `0xb7432c991be3167689d5e80c9e2bf1ff5cccd2e0` | `0x9dbf2b5f96cb31a48cca4e25d2c8348be414ebc8` |

Production is [Ethereum mainnet](/docs/networks/ethereum/). The testnets are
[Sepolia](/docs/networks/sepolia/) and [Eden testnet](/docs/networks/eden/).
The same address on two networks does not mean the same version. Check each
network's page for what it runs.

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
| `IdentityRegistry` | `0x105b32e3daa9fda3572e89992c73b85a8a1065b3` |
| `HandleEscrow` | `0xcd1fb9627c011cce322dabfcbcb4a09f66b26432` |
| `CeremonyProofVerifier` | `0xbf95e2ecad436a807f3204ac4cf388f3fa7b7b77` |
| `NotaryService` | `0x562ff3231d8d3f8b0615914186e858c7cbfc2994` |
| GitHub platform verifier | `0x12126c434c906ae8fc9731a96845bbf7bb679b9b` |
| X platform verifier | `0x2a529253505b724a2ebd284ad40fcde5cc1dd5a7` |
| Google platform verifier | `0xc32fca530bfe3c7f54bcb69cec8d965d4a52c73d` |
| `GoogleJwtRoots` | `0x70580b148be716ad86da3f94243c9a8f3d5768bc` |
| `LibidFactory` | `0x49852bc32a52a5cb5cdda135d1b244f5f5d57226` |

The local-chain project the guides' output comes from is different. It
deploys `IdentityRegistry`, a `CeremonyProofVerifier` with test verifiers,
and `HandleEscrow`, with plain CREATE from anvil's first account. The two
your code uses land at:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HandleEscrow` | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` |

That project is not published yet.
