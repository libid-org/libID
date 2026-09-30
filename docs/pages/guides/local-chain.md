---
title: Test on a local chain
description: Run libID on anvil with known test data, so every guide works on your machine.
sidebar:
  order: 6
---

You can run libID on your own machine with [anvil](https://getfoundry.sh).
The [local-chain](https://github.com/libid-org/examples/tree/main/local-chain)
project deploys `IdentityNames` and `HandleEscrow` from libID-contracts
v0.14.0, and binds a few test handles. Every guide in these docs runs against
it without changes.

It uses test verifiers that accept any binding without a proof. Use it only
for local testing.

## Start it

You need [Foundry](https://getfoundry.sh). Clone the examples:

```sh
git clone --recursive https://github.com/libid-org/examples
cd examples/local-chain
```

Start anvil in its own terminal:

```sh
anvil
```

Then deploy, and load the settings it writes:

```sh
./start.sh && source local.env
```

`local.env` sets the variables the guides read:

| Variable | Value |
| --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` |
| `IDENTITY_NAMES` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HANDLE_ESCROW` | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` |
| `PRIVATE_KEY` | a funded test key; its wallet owns `alice-dev` and `alice_x` |
| `CAROL_KEY` | a second funded test key, for Carol in [Send funds to a handle](/docs/guides/pay-a-handle/) |

The keys are anvil's public test keys. Never use them on a real network.

Run the guides' code from a shell where you have sourced `local.env`.

## Test data

| Handle | Account id | Wallet |
| --- | --- | --- |
| GitHub `octocat` | `583231` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| GitHub `alice-dev` | `1001` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| X `alice_x` | `2244994945` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

Each handle is also its wallet's primary name.

## Bind another handle

```sh
./bind.sh github 777 carol $CAROL_KEY
```

The arguments are the platform, the account id, the handle, and the key of
the wallet to bind it to.

## Start over

Stop anvil and start it again, then run `./start.sh` again. A fresh anvil
always gives the same addresses.
