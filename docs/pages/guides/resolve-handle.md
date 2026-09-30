---
title: Resolve a handle
description: Find the wallet behind a handle, and check how fresh the answer is.
sidebar:
  order: 2
---

This guide shows how to turn a handle into a wallet, and how to see when the
owner last proved it.

The examples use the setup from the [Quickstart](/docs/get-started/quickstart/):

```js
import { createPublicClient, http } from 'viem';
import { identityNamesAbi, platformId, resolveHandle } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const names = { client, address: '0xe78b53a183dd51763df44beb2500ddab9bb0329e' };
const github = platformId('github');
```

## Find the wallet

```js
const wallet = await resolveHandle(names, github, 'octocat');
```

You get the wallet that proved the handle most recently, or `null`.

You can pass whatever a user typed. The contract normalizes the handle first,
so `@Octocat` finds `octocat`. Text that can never be a handle on that
platform, such as `oct cat`, also returns `null`.

If the platform id is wrong, the call reverts with `UnknownPlatform`. A
typo in the platform name shows up as an error, not as an empty result.

## See when it was proved

A binding records the time the platform confirmed the account. Read it with
`nodeOf` and `byHandle`:

```js
const node = await client.readContract({
  address: names.address,
  abi: identityNamesAbi,
  functionName: 'nodeOf',
  args: [github, 'octocat'],
});

const [owner, observedAt] = await client.readContract({
  address: names.address,
  abi: identityNamesAbi,
  functionName: 'byHandle',
  args: [node],
});

console.log(owner, new Date(Number(observedAt) * 1000));
```

`nodeOf` turns a platform and a handle into the `bytes32` key the contract
stores it under. `byHandle` returns the owner of that key and `observedAt`, a
Unix time in seconds.

Handles can be renamed and reused on the platform. The older `observedAt`
is, the more likely the handle now belongs to someone else there. Show it to
your users before they send anything, or refuse bindings older than you are
comfortable with.

## From Solidity

`IdentityNames` answers the same calls from a contract. See
[Gate a contract](/docs/guides/gate-contract/).
