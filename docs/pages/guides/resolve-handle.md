---
title: Resolve a handle
description: Find the wallet behind a handle, and check how fresh the answer is.
sidebar:
  order: 2
---

This guide shows how to turn a handle into a wallet, how to see when the
owner last proved it, and how to notice that a handle moved to another
account.

The examples use the setup from the [Quickstart](/docs/get-started/quickstart/):

```js
import { createPublicClient, http } from 'viem';
import {
  accountCount,
  accountsOf,
  identityNamesAbi,
  platformId,
  resolveHandle,
  resolvePair,
} from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const names = { client, address: process.env.IDENTITY_NAMES };
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

`observedAt` can be a little ahead of the current time. For Google it is the
expiry of the sign-in token, up to an hour after the user signed in. So count
a negative age as zero:

```js
const age = Math.max(0, Math.floor(Date.now() / 1000) - Number(observedAt));
```

Handles can be renamed and reused on the platform. The older `observedAt`
is, the more likely the handle now belongs to someone else there. Show it to
your users before they send anything, or refuse bindings older than you are
comfortable with.

## Notice a new owner

A handle can move to a different account on the platform. Someone who paid
`@octocat` last month may now be paying a stranger.

The contract cannot tell you this on its own. Your app has to remember who
owned the handle before. When a user first pays or saves a handle, store the
account id behind it:

```js
async function accountIdOf(wallet, platform, handle) {
  const count = await accountCount(names, wallet);
  for (let from = 0n; from < count; from += 10n) {
    for (const a of await accountsOf(names, wallet, from, 10n)) {
      if (a.platformId === platform && a.handle === handle && a.handleCurrent) return a.userId;
    }
  }
  return null;
}

const savedUserId = await accountIdOf(wallet, github, 'octocat'); // keep this with the contact
```

`accountIdOf` reads the wallet's accounts a page at a time and returns the
account that holds the handle now, or `null`. Pass the handle in its
normalized form, the way `IdentityBound` reports it: lowercase, without `@`.

Next time, pass the saved id to `resolvePair`:

```js
if (savedUserId) {
  const { wallet: current, idAgrees } = await resolvePair(names, github, 'octocat', savedUserId);
  if (!idAgrees) {
    console.log('@octocat now belongs to a different account.');
  }
}
```

`resolvePair` compares wallets, not accounts. `idAgrees` is `true` when the
handle and the saved account id resolve to the same wallet, and that wallet
is not zero. So:

| What happened since you saved the id | `wallet` | `idAgrees` |
| --- | --- | --- |
| Nothing | the same wallet | `true` |
| The account moved to a new wallet | the new wallet | `true` |
| Another account, in another wallet, took the handle | the new wallet | `false` |
| The account switched to a new handle, and nobody holds this one | zero | `false` |
| Another account in the same wallet took the handle | the same wallet | `true` |

The last row is the one it cannot see: the payment still goes to the same
wallet, but through a different account.

Only use this with an id you saved earlier. An id you read just now always
agrees, so the check tells you nothing. If your app has nothing saved, show
`observedAt` from the section above instead.

What to do with `false` depends on what the user asked for:

- "Pay whoever holds @octocat now." The payment is right. Tell the user the
  handle changed owner, and send.
- "Pay the person I paid last time." The handle no longer leads to them.
  Stop and ask the user before sending.

## From Solidity

`IdentityNames` answers the same calls from a contract. See
[Gate a contract](/docs/guides/gate-contract/).
