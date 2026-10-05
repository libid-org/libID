---
title: Quickstart
description: Read a libID name from the chain in a few minutes.
sidebar:
  order: 1
---

In this guide you will find the address that holds a GitHub handle, and then
the GitHub handle that address publishes. You only read from the chain, so you need no
wallet and no tokens.

## Set up

You need [Node.js](https://nodejs.org) 22.12 or later, and a network that runs
libID. Set `RPC_URL` and `IDENTITY_REGISTRY` for it. For Ethereum mainnet:

```sh
export RPC_URL=https://ethereum-rpc.publicnode.com
export IDENTITY_REGISTRY=0xbefd300aff7d4a67fb381afe8b3596793d3e9a83
```

The other networks are listed under [Networks](/docs/networks/ethereum/).
The output below comes from a [local chain](/docs/guides/local-chain/#the-guides-test-data)
where `octocat` is bound.

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
import { platformId, resolveHandle, publishedHandleOf } from '@libid/contracts';

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
const holder = await resolveHandle(registry, github, 'octocat');
console.log(holder);
```

`resolveHandle` returns the address that proved it holds the handle, or `null`
if nobody has. Handles are matched the way the platform matches them, so
`octocat`, `Octocat` and `@octocat` are the same GitHub handle.

## Find the handle of a holder

Now go the other way:

```js
if (holder) {
  const handle = await publishedHandleOf(registry, holder, github);
  console.log(handle);
}
```

`publishedHandleOf` returns the handle the holder published on that platform.
It returns `null` if the holder has not published one, or if the handle now
belongs to someone else.

## Run it

```sh
node index.mjs
```

If nobody has bound `octocat` on your network, it prints `null`. Try a
handle that someone has bound. On the local chain, where `octocat` is bound,
you will see:

```
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
octocat
```

## Without code

You can make the same call with [Foundry](https://getfoundry.sh)'s `cast`:

```sh
cast call $IDENTITY_REGISTRY 'resolveHandle(bytes32,string)(address)' \
  $(cast keccak github) octocat --rpc-url $RPC_URL
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
