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
| `IdentityRegistry` | `0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D` |
| `HandleEscrow` | `0xE7eb0c675B757C12B1312dF652242b863624Bfab` |
| `CeremonyProofVerifier` | `0x6E4585c4f1aC48a20f49bB61163C466DC4f35004` |
| `NotaryService` | `0xfCf39134654e3542B956Ee6E315cA650E6bA3b8C` |
| GitHub platform verifier | `0x13Cdf6d5666A42E0Eb586809F46ce10E469D11f7` |
| X platform verifier | `0x655Be95A91A26B4ADe476A8992Ee25C98BB774a6` |
| Google platform verifier | `0x355143c93A645ae914b1315eB1B580072207e0f2` |
| `GoogleJwtRoots` | `0x4D9C43D4CF161452b7F66415FA492f4fc42eA583` |
| `LibidFactory` | `0x5294f6c0f1F086f70c9b510Ba7990085D5976281` |

Most apps only need `IdentityRegistry`. Your code talks to the others only if it
builds proofs itself.

## Network status

These docs describe libID-contracts v0.21.0.

| Network | `IdentityRegistry` | `HandleEscrow` v0.21.0 |
| --- | --- | --- |
| [Sepolia](/docs/networks/sepolia/) | deployed, testnet address above | no code yet |
| [Eden testnet](/docs/networks/eden/) | deployed, testnet address above | no code yet |
| [Ethereum mainnet](/docs/networks/ethereum/) | v0.17.0, at another address | no code yet |

On Sepolia and Eden, every contract in the table above except
`HandleEscrow` is deployed and runs the v0.21.0 code.

The v0.21.0 `HandleEscrow` is a new contract, not an upgrade, so it has a
new address. Until it has code, the escrow guides run only on a
[local chain](/docs/guides/local-chain/). Check before you send:

```sh
cast code 0xE7eb0c675B757C12B1312dF652242b863624Bfab --rpc-url $RPC_URL
```

`0x` means no code. A call to an address with no code succeeds, and the
funds you send with it are lost.

The v0.19.0 escrow still runs on both testnets, at
`0xF3f81C31C889DdF1ec83B91b3DFED601C04F5E50`. Its `deposit` takes a
`refundTo` address. These docs do not describe it.

Ethereum mainnet will get its own addresses. chain-configurations declares
`IdentityRegistry` at `0xF39343fEbdA25cAa8C3861954E33F8a0189D4FDA` and
`HandleEscrow` at `0xf2731aB2c9451A9191e0Ef64D7fd5352068eB1b5`. Neither has
code yet.

The same address on two networks does not by itself mean the same version:
an upgrade on one network does not change the other. The addresses are not
final. They follow each deployment.

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
| `IdentityRegistry` | `0x155090A3A2dded2FbdF385bAC8cfFEb3a51A18ae` |
| `HandleEscrow` | `0xEd2E993A615d8D6b28000034ac58fB6389fe038e` |
| `CeremonyProofVerifier` | `0x145307aAf8DC22FB850Aae44aeA19628df20E9f6` |
| `NotaryService` | `0x278e8BA43e16e1D757FE77590EdB759d85860483` |
| GitHub platform verifier | `0x1AaFD47fb1E7c68a1c9AFC19d06cCcCD958cC4D6` |
| X platform verifier | `0x37bE0160c6E2E2e089010D178c7be3EE27602628` |
| Google platform verifier | `0xFCB24d6491120569c91370dd8Fa5441ADB1D94ee` |
| `GoogleJwtRoots` | `0x6D5BC82C9a8a6A05a9319c9e9D5FC43fF80552ac` |
| `LibidFactory` | `0x13089b18e7fDcdeDDe55F6B85451561a8B725825` |

The local-chain project the guides' output comes from is different. It
deploys `IdentityRegistry`, a `CeremonyProofVerifier` with test verifiers,
and `HandleEscrow`, with plain CREATE from anvil's first account. The two
your code uses land at:

| Contract | Address |
| --- | --- |
| `IdentityRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HandleEscrow` | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |

That project is not published yet.
