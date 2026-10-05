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

The code in the guides reads `RPC_URL` and `IDENTITY_REGISTRY`. Point them at
Ethereum mainnet:

```sh
export RPC_URL=https://ethereum-rpc.publicnode.com
export IDENTITY_REGISTRY=0xbefd300aff7d4a67fb381afe8b3596793d3e9a83
```

See [Networks](/docs/networks/ethereum/) for the others. The guides' test
handles and addresses are not bound there, so you get `null` or an empty
list where a guide shows output. Use a handle or an address that has bound
an identity instead.

## Deploy the stack to anvil

[chain-configurations](https://github.com/libid-org/chain-configurations)
has a network file for anvil, `local-dev.toml`, and the `libid-deploy` tool
that applies it. Download `libid-deploy` for your platform from its
[releases](https://github.com/libid-org/chain-configurations/releases), and
the network file:

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
export IDENTITY_REGISTRY=0x105b32e3daa9fda3572e89992c73b85a8a1065b3
export HANDLE_ESCROW=0xcd1fb9627c011cce322dabfcbcb4a09f66b26432
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

| Handle | Id | Holder |
| --- | --- | --- |
| GitHub `octocat` | `583231` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| GitHub `alice-dev` | `1001` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| X `alice_x` | `2244994945` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

Each handle is also its holder's published handle. `PRIVATE_KEY`'s address
holds `alice-dev` and `alice_x`.

It also has `./bind.sh`, which binds a handle without a proof:

```sh
./bind.sh github 777 carol $CAROL_KEY
```

The arguments are the platform, the id, the handle, and the key of the
holder to bind it to.
