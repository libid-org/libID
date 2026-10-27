---
title: Test on a local chain
description: Run libID on anvil, and what the guides' test data is.
sidebar:
  order: 6
---

The guides were written against a local-chain project: `IdentityRegistry`
and `HandleEscrow` on [anvil](https://getfoundry.sh), with test verifiers
that accept any binding without a proof, and a few test handles bound. That
project is not published yet. Until it is, you can:

- run the read-only code against a public network, or
- deploy the full libID stack to anvil with `libid-deploy`. It starts with
  nothing bound.

## Read from a public network

The code in the guides reads `RPC_URL`, `IDENTITY_REGISTRY` and
`HANDLE_ESCROW`, and the events guide reads `FROM_BLOCK`. Point them at
the Eden testnet:

```sh
export RPC_URL=https://ev-reth-eden-testnet.binarybuilders.services:8545
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=291663483
```

The guides' test handles and addresses are not bound there, so you get
`null` or an empty list where a guide shows output. Use a handle or an
address that has bound an identity instead. `HANDLE_ESCROW` has no code
there yet, so do not send to it; see
[Network status](/docs/reference/addresses/#network-status).

Sepolia has the same contract addresses; see [Sepolia](/docs/networks/sepolia/).
Ethereum mainnet runs an older version, which the guides do not match. See
[Network status](/docs/reference/addresses/#network-status).

## Deploy the stack to anvil

[chain-configurations](https://github.com/libid-org/chain-configurations)
has a network file for anvil, `local-dev.toml`, and the `libid-deploy` tool
that applies it. No `libid-deploy` release ships v0.21.0 yet, so build it
from the repository with [Rust](https://rustup.rs):

```sh
cargo install --locked --git https://github.com/libid-org/chain-configurations libid-deploy
```

Then download the network file:

```sh
curl -LO https://raw.githubusercontent.com/libid-org/chain-configurations/main/networks/local-dev.toml
```

Start anvil in its own terminal:

```sh
anvil
```

Then deploy:

```sh
libid-deploy apply --network local-dev.toml \
  --rpc-url http://127.0.0.1:8545 --yes --confirm-fresh-deploy
```

It deploys every libID contract with the real verifiers, owned by anvil's
first account. The addresses are fixed; see
[Addresses](/docs/reference/addresses/#local-stacks). Set the guides'
variables:

```sh
export RPC_URL=http://127.0.0.1:8545
export IDENTITY_REGISTRY=0x155090A3A2dded2FbdF385bAC8cfFEb3a51A18ae
export HANDLE_ESCROW=0xEd2E993A615d8D6b28000034ac58fB6389fe038e
export PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export CAROL_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
```

The keys are anvil's public test keys. Never use them on a real network.

Nothing is bound on this stack, and a binding needs a real proof. So the
lookups return `null`, and you can deploy contracts and send to the escrow,
but not bind a handle or claim from it.

## The guides' test data

Where a guide shows output, it comes from the local-chain project. It sets
`RPC_URL`, `IDENTITY_REGISTRY`, `HANDLE_ESCROW`, `PRIVATE_KEY` and
`CAROL_KEY` as above, with its own registry and escrow
[addresses](/docs/reference/addresses/#local-stacks), and binds:

| Handle | Id | Holder | Primary handle |
| --- | --- | --- | --- |
| GitHub `octocat` | `583231` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | yes |
| GitHub `alice-dev` | `1001` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | yes |
| X `alice_x` | `2244994945` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | no, revealed only |

`PRIVATE_KEY`'s address holds `alice-dev` and `alice_x`. A wallet has one
primary handle, so its name is `alice-dev`.

It also has `./bind.sh`, which binds a handle without a proof:

```sh
./bind.sh github 777 carol $CAROL_KEY
```

The arguments are the platform, the id, the handle, and the key of the
holder to bind it to. The handle becomes that holder's primary handle.
