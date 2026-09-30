---
title: Quickstart
description: Read a libID name from the chain in a few minutes.
sidebar:
  order: 1
---

In this guide you will look up who owns a GitHub account, and then do the
same lookup in reverse. You only read from the chain, so you need no wallet
and no tokens.

The examples use the Eden testnet. The `IdentityNames` contract has the same
address on every network, so only the RPC URL changes.

## Set up

You need [Node.js](https://nodejs.org) 18 or later. Create a project and
install [viem](https://viem.sh):

```sh
mkdir libid-quickstart && cd libid-quickstart
npm init -y
npm install viem
```

## Connect to IdentityNames

Create `index.mjs`:

```js
import { createPublicClient, http, parseAbi, keccak256, toHex } from 'viem';

const client = createPublicClient({
  transport: http('https://ev-reth-eden-testnet.binarybuilders.services:8545'),
});

const identityNames = {
  address: '0xe78b53a183dd51763df44beb2500ddab9bb0329e',
  abi: parseAbi([
    'function resolveHandle(bytes32 platformId, string handle) view returns (address)',
    'function primaryOf(address wallet, bytes32 platformId) view returns (string)',
  ]),
};

const github = keccak256(toHex('github'));
```

Every platform has an id. It is the keccak256 hash of the platform's name, so
GitHub is `keccak256("github")`. X and Google are `"x"` and `"google"`.

## Find the wallet for a handle

Add this to `index.mjs`:

```js
const wallet = await client.readContract({
  ...identityNames,
  functionName: 'resolveHandle',
  args: [github, 'Wondertan'],
});
console.log(wallet);
```

`resolveHandle` returns the wallet that proved it owns the handle. Handles
are matched the way the platform matches them, so `Wondertan` and `wondertan`
give the same answer. A handle nobody has proved returns the zero address.

## Find the name for a wallet

Now go the other way:

```js
const handle = await client.readContract({
  ...identityNames,
  functionName: 'primaryOf',
  args: [wallet, github],
});
console.log(handle);
```

`primaryOf` returns the handle the wallet chose to show on that platform. It
returns an empty string if the wallet has not chosen one, or if the handle now
belongs to someone else.

## Run it

```sh
node index.mjs
```

You should see:

```
0xF4F9cdD1A7A67c528475d995318A7DE42C95A103
wondertan
```

## Without code

You can make the same call with [Foundry](https://getfoundry.sh)'s `cast`:

```sh
cast call 0xe78b53a183dd51763df44beb2500ddab9bb0329e \
  'resolveHandle(bytes32,string)(address)' \
  $(cast keccak github) Wondertan \
  --rpc-url https://ev-reth-eden-testnet.binarybuilders.services:8545
```

## Next steps

- [Platforms and nodes](/docs/concepts/platforms-and-nodes/) explains the ids
  behind these calls.
- [Gate a contract](/docs/guides/gate-contract/) does the same lookup from
  Solidity.
- [Addresses](/docs/reference/addresses/) lists every network libID is on.
