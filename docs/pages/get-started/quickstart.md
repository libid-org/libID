---
title: Quickstart
description: Read a libID name from the chain in a few minutes.
sidebar:
  order: 1
---

In this guide you will find the wallet behind a GitHub handle, and then the
GitHub handle behind a wallet. You only read from the chain, so you need no
wallet and no tokens.

## Set up

You need [Node.js](https://nodejs.org) 20 or later, and a network that runs
libID. No public network runs the version these docs describe yet, so start
the [local chain](/docs/guides/local-chain/) first. When `local.env` is
loaded, `RPC_URL` and `IDENTITY_NAMES` are set.

Create a project and install [viem](https://viem.sh) and the libID contracts
package:

```sh
mkdir libid-quickstart && cd libid-quickstart
npm init -y
npm install viem @libid/contracts
```

## Connect to IdentityNames

`IdentityNames` is the contract that stores who owns which account.

Create `index.mjs`:

```js
import { createPublicClient, http } from 'viem';
import { platformId, resolveHandle, primaryName } from '@libid/contracts';

const names = {
  client: createPublicClient({ transport: http(process.env.RPC_URL) }),
  address: process.env.IDENTITY_NAMES,
};

const github = platformId('github');
```

Every platform has an id. `platformId('github')` is the keccak256 hash of the
string `github`. The other platforms are `'x'` and `'google'`.

## Find the wallet for a handle

Add this to `index.mjs`:

```js
const wallet = await resolveHandle(names, github, 'octocat');
console.log(wallet);
```

`resolveHandle` returns the wallet that proved it owns the handle, or `null`
if nobody has. Handles are matched the way the platform matches them, so
`octocat`, `Octocat` and `@octocat` are the same GitHub handle.

## Find the name for a wallet

Now go the other way:

```js
if (wallet) {
  const handle = await primaryName(names, wallet, github);
  console.log(handle);
}
```

`primaryName` returns the handle the wallet chose to show on that platform.
It returns `null` if the wallet has not chosen one, or if the handle now
belongs to someone else.

## Run it

```sh
node index.mjs
```

On the local chain you will see:

```
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
octocat
```

## Without code

You can make the same call with [Foundry](https://getfoundry.sh)'s `cast`:

```sh
cast call $IDENTITY_NAMES 'resolveHandle(bytes32,string)(address)' \
  $(cast keccak github) octocat --rpc-url $RPC_URL
```

## On a public network

Set `RPC_URL` to the network's RPC, and `IDENTITY_NAMES` to
`0xe78b53a183dd51763df44beb2500ddab9bb0329e`, the address `IdentityNames` has
on every public network. See [Networks](/docs/networks/eden/) for what runs
where.

## Next steps

- [Resolve a handle](/docs/guides/resolve-handle/) covers what else you can
  learn about a handle, such as when it was last proved.
- [Look up a wallet](/docs/guides/lookup-wallet/) lists every account a
  wallet owns.
- [Gate a contract](/docs/guides/gate-contract/) does the same checks from
  Solidity.
