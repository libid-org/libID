---
title: Addresses
description: libID contract addresses on every network, and on a local stack.
sidebar:
  order: 3
---

libID deploys every contract through a factory with CREATE3. An address
depends only on the contract's name and the factory, and each environment
has its own factory. So a contract has one address on every testnet and
another on every production network. Upgrades keep a contract at the same
address.

| Contract | Testnets | Ethereum mainnet |
| --- | --- | --- |
| `IdentityRegistry` | `0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D` | `0xF39343fEbdA25cAa8C3861954E33F8a0189D4FDA` |
| `HandleEscrow` | `0xE7eb0c675B757C12B1312dF652242b863624Bfab` | `0xf2731aB2c9451A9191e0Ef64D7fd5352068eB1b5` |
| `CeremonyProofVerifier` | `0x6E4585c4f1aC48a20f49bB61163C466DC4f35004` | `0xcFEE504d5A290d72c52b9Ffd61D54444D727233B` |
| `NotaryService` | `0xfCf39134654e3542B956Ee6E315cA650E6bA3b8C` | `0x4f624a90AE152e524b12258ce6aA9df6Ed70DDfB` |
| GitHub platform verifier | `0x13Cdf6d5666A42E0Eb586809F46ce10E469D11f7` | `0x4f6D4a3486A00B260A1dD91F9Dde6F333De6861F` |
| X platform verifier | `0x655Be95A91A26B4ADe476A8992Ee25C98BB774a6` | `0xE9b6D548A070FcAA5B43344C0b495d982AAA9Fc4` |
| Google platform verifier | `0x355143c93A645ae914b1315eB1B580072207e0f2` | `0x731F3943879cCf40a21A7B84E9B7Ec01776CB9cc` |
| `GoogleJwtRoots` | `0x4D9C43D4CF161452b7F66415FA492f4fc42eA583` | `0xA2C959B2940bdB8f97Af52401c1603000A3aa46b` |
| `LibidFactory` | `0x5294f6c0f1F086f70c9b510Ba7990085D5976281` | `0x4aB4177683b8C3f40C487f9e765f77F0c5f5A023` |

The testnets are [Sepolia](/docs/networks/sepolia/) and the
[Eden testnet](/docs/networks/eden/). All three networks run
libID-contracts v0.21.0, the version these docs describe.

Most apps only need `IdentityRegistry`, and `HandleEscrow` to send funds to
a handle. Your code talks to the others only if it builds proofs itself.

The same address on two networks does not by itself mean the same version:
an upgrade on one network does not change the other. The addresses are not
final. They follow each deployment.

Before mainnet ran v0.21.0, it ran v0.17.0 at other addresses. These docs do
not describe that version.

These addresses come from
[chain-configurations](https://github.com/libid-org/chain-configurations/tree/main/networks),
where `libid-deploy plan --print-addresses` generates them. If this page and
that repository disagree, trust the repository.

## Local stacks

`local-dev.toml` in chain-configurations deploys the full stack the way the
public networks do: through a factory with CREATE3, with anvil's first
account as the deployer. On a fresh anvil:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0x155090A3A2dded2FbdF385bAC8cfFEb3a51A18ae` |
| `HandleEscrow` | `0xEd2E993A615d8D6b28000034ac58fB6389fe038e` |
| `CeremonyProofVerifier` | `0x145307aAf8DC22FB850Aae44aeA19628df20E9f6` |
| `NotaryService` | `0x278e8BA43e16e1D757FE77590EdB759d85860483` |
| GitHub platform verifier | `0x1AaFD47fb1E7c68a1c9AFC19d06cCcCD958cC4D6` |
| X platform verifier | `0x37bE0160c6E2E2e089010D178c7be3EE27602628` |
| Google platform verifier | `0xFCB24d6491120569c91370dd8Fa5441ADB1D94ee` |
| `GoogleJwtRoots` | `0x6D5BC82C9a8a6A05a9319c9e9D5FC43fF80552ac` |
| `LibidFactory` | `0x13089b18e7fDcdeDDe55F6B85451561a8B725825` |

To run the guides against Sepolia's contracts and bindings on your machine,
fork Sepolia instead; see [Test on a local chain](/docs/guides/local-chain/).
