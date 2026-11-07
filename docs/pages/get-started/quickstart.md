---
title: Quickstart
description: Read a libID name from the chain in a few minutes.
sidebar:
  order: 1
---

In this guide you will find the address that holds a GitHub handle, and then
the handle that address shows as its name. You only read from the chain, so you need no
wallet and no tokens.

## Set up

You need [Node.js](https://nodejs.org) 22.12 or later, and a network that runs
libID. Set `RPC_URL` and `IDENTITY_REGISTRY` for it. For Sepolia:

```sh
export RPC_URL=https://sepolia.gateway.tenderly.co
export IDENTITY_REGISTRY=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
```

The other networks are listed under [Networks](/docs/networks/ethereum/).
The guides use the GitHub handle `testyakly`, which is bound on Sepolia.

Create a project and install [viem](https://viem.sh) and the libID contracts
package:

```sh
mkdir libid-quickstart && cd libid-quickstart
npm init -y
npm install viem @libid/contracts
```

## Connect to IdentityRegistry

`IdentityRegistry` is the contract that stores which address holds which
identity: a platform account it has proved.

Create `index.mjs`:

```js
import { createPublicClient, http } from 'viem';
import { platformId, primaryHandleOf, resolveHandle } from '@libid/contracts';

const registry = {
  client: createPublicClient({ transport: http(process.env.RPC_URL) }),
  address: process.env.IDENTITY_REGISTRY,
};

const github = platformId('github');
```

Every platform has an id. `platformId('github')` is the keccak256 hash of the
string `github`. The other platforms are `'x'` and `'google'`.

## Find the holder of a handle

Add this to `index.mjs`:

```js
const holder = await resolveHandle(registry, github, 'testyakly');
console.log(holder);
```

`resolveHandle` returns the address that proved it holds the handle, or `null`
if nobody has. Only A to Z are folded to lowercase, so `TestYakly` finds
`testyakly`. `@testyakly` is different text, and nobody holds it.

## Find the handle of a holder

Now go the other way:

```js
if (holder) {
  const primary = await primaryHandleOf(registry, holder);
  console.log(primary?.handle);
}
```

`primaryHandleOf` returns the one handle the holder chose as its name, and
its `platformId`. A holder has at most one, on any platform. It returns
`null` if the holder has not chosen one, or if the handle now belongs to
someone else.

## Run it

```sh
node index.mjs
```

On Sepolia you will see:

```
0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c
testyakly
```

On another network, nobody may hold `testyakly`, and it prints `null`. Try a
handle that someone has bound there.

## Without code

You can make the same call with [Foundry](https://getfoundry.sh)'s `cast`:

```sh
cast call $IDENTITY_REGISTRY 'resolveHandle(bytes32,string)(address)' \
  $(cast keccak github) testyakly --rpc-url $RPC_URL
```

See [Addresses](/docs/reference/addresses/) for every contract on every
network.

## Next steps

- [Resolve a handle](/docs/guides/resolve-handle/) covers what else you can
  learn about a handle, such as when it was last proved.
- [Look up a wallet](/docs/guides/lookup-wallet/) lists every identity an
  address holds.
- [Gate a contract](/docs/guides/gate-contract/) does the same checks from
  Solidity.
