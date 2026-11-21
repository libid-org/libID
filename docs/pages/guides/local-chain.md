---
title: Test on a local chain
description: Run the guides on a fork of Sepolia, or deploy libID to anvil.
sidebar:
  order: 6
---

The guides run against [Sepolia](/docs/networks/sepolia/). To try the parts
that send transactions without spending anything, run them on a local fork
of Sepolia. Or deploy your own libID stack to anvil.

## Fork Sepolia

[anvil](https://getfoundry.sh) can fork a network: it reads Sepolia's state
on demand and keeps your transactions local. The libID contracts, and the
handles bound on Sepolia, such as `testyakly`, are all there.

Start it in its own terminal:

```sh
anvil --fork-url https://sepolia.gateway.tenderly.co
```

Then point the guides at it. The contract addresses are Sepolia's:

```sh
export RPC_URL=http://127.0.0.1:8545
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
export HANDLE_ESCROW=0xE7eb0c675B757C12B1312dF652242b863624Bfab
export FROM_BLOCK=11963763
export PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

`PRIVATE_KEY` is one of anvil's public test keys, funded on the fork. Never
use it on a real network.

On a fork you can also move the clock, for example past the escrow's 30-day
refund wait:

```sh
cast rpc evm_increaseTime 2592000 --rpc-url $RPC_URL && cast rpc evm_mine --rpc-url $RPC_URL
```

You cannot bind a new handle on a fork without a real proof. To act as an
address that already holds one, such as the holder of `testyakly`, let anvil
send for it without its key:

```sh
cast rpc anvil_impersonateAccount 0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c --rpc-url $RPC_URL
```

Then send with `cast send --unlocked --from 0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c`.

Pass `--fork-block-number` to start from a fixed block, so that every run
sees the same state. The docs' own check does this.

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
```

The keys are anvil's public test keys. Never use them on a real network.

Nothing is bound on this stack, and a binding needs a real proof. So the
lookups return `null`, and you can deploy contracts and send to the escrow,
but not bind a handle or claim from it. For bound handles, use a fork.
