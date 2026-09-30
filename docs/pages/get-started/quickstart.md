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
libID. No public network runs the version these docs describe yet, so start a
local one: [Test on a local chain](/docs/guides/local-chain/) takes a few
minutes and gives you known handles, including `octocat`.

Create a project and install [viem](https://viem.sh) and the libID contracts
package:

```sh
mkdir libid-quickstart && cd libid-quickstart
npm init -y
npm install viem @libid/contracts
```

## Connect to IdentityNames

`IdentityNames` is the contract that stores who owns which account. It has
the same address on every public network. On the local chain it is
`0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`; use that instead.

Create `index.mjs`:

```js
import { createPublicClient, http } from 'viem';
import { platformId, resolveHandle, primaryName } from '@libid/contracts';

const names = {
  client: createPublicClient({ transport: http(process.env.RPC_URL) }),
  address: '0xe78b53a183dd51763df44beb2500ddab9bb0329e',
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
RPC_URL=http://127.0.0.1:8545 node index.mjs
```

On the local chain you will see:

```
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
octocat
```

On another network, you will see `null` if nobody has proved `octocat`
there.

## Without code

You can make the same call with [Foundry](https://getfoundry.sh)'s `cast`:

```sh
cast call 0xe78b53a183dd51763df44beb2500ddab9bb0329e \
  'resolveHandle(bytes32,string)(address)' \
  $(cast keccak github) octocat \
  --rpc-url $RPC_URL
```

## Next steps

- [Resolve a handle](/docs/guides/resolve-handle/) covers what else you can
  learn about a handle, such as when it was last proved.
- [Look up a wallet](/docs/guides/lookup-wallet/) lists every account a
  wallet owns.
- [Gate a contract](/docs/guides/gate-contract/) does the same checks from
  Solidity.
