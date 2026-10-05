---
title: Resolve a handle
description: Find the holder behind a handle, and check how fresh the answer is.
sidebar:
  order: 2
---

This guide shows how to turn a handle into the address that holds it, how to
see when it was last proved, and how to notice that a handle moved to another
identity.

The examples use the setup from the [Quickstart](/docs/get-started/quickstart/):

```js
import { createPublicClient, http } from 'viem';
import {
  identityCount,
  identitiesOf,
  identityRegistryAbi,
  platformId,
  resolveHandle,
  resolveHandleAndId,
} from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const registry = { client, address: process.env.IDENTITY_REGISTRY };
const github = platformId('github');
```

## Find the holder

```js
const holder = await resolveHandle(registry, github, 'octocat');
```

You get the holder that proved the handle most recently, or `null`.

You can pass whatever a user typed. The contract normalizes the handle first,
so `@Octocat` finds `octocat`. Text that can never be a handle on that
platform, such as `oct cat`, also returns `null`.

If the platform id is wrong, the call reverts with `UnknownPlatform`. A typo
in the platform key shows up as an error, not as an empty result.

## See when it was proved

A binding records the time the platform confirmed it. Read it with
`handleNodeOf` and `handleBinding`:

```js
const node = await client.readContract({
  address: registry.address,
  abi: identityRegistryAbi,
  functionName: 'handleNodeOf',
  args: [github, 'octocat'],
});

const [current, observedAt] = await client.readContract({
  address: registry.address,
  abi: identityRegistryAbi,
  functionName: 'handleBinding',
  args: [node],
});

console.log(current, new Date(Number(observedAt) * 1000));
```

`handleNodeOf` turns a platform and a handle into the `bytes32` key the
contract stores it under. `handleBinding` returns the holder of that key and
`observedAt`, a Unix time in seconds.

The age of the proof is the time since then:

```js
const age = Math.floor(Date.now() / 1000) - Number(observedAt);
```

A proof bound a moment ago can already read up to 65 minutes old on GitHub
and X, and up to 2 hours on Google. See [Freshness](/docs/concepts/freshness/).

Handles can be renamed and reused on the platform. The older `observedAt`
is, the more likely the handle now belongs to someone else there. Show it to
your users before they send anything, or refuse bindings older than you are
comfortable with.

## Notice a new holder

A handle can move to a different account on the platform. Someone who paid
`@octocat` last month may now be paying a stranger.

The contract cannot tell you this on its own. Your app has to remember who
held the handle before. When a user first pays or saves a handle, store the
id of the identity behind it:

```js
async function idOf(holder, platform, handle) {
  if (!holder) return null;
  const count = await identityCount(registry, holder);
  for (let from = 0n; from < count; from += 10n) {
    for (const i of await identitiesOf(registry, holder, from, 10n)) {
      if (i.platformId === platform && i.handle === handle && i.handleCurrent) return i.id;
    }
  }
  return null;
}

const savedId = await idOf(holder, github, 'octocat'); // keep this with the contact
```

`idOf` reads the holder's identities a page at a time and returns the id of
the one that holds the handle now. It returns `null` if nobody holds the
handle. Pass the handle in its
normalized form, the way `IdentityBound` reports it: lowercase, without `@`.

Next time, pass the saved id to `resolveHandleAndId`:

```js
if (savedId) {
  const { holder: now, idAgrees } = await resolveHandleAndId(registry, github, 'octocat', savedId);
  if (!idAgrees) {
    console.log('@octocat now belongs to a different account.');
  }
}
```

`resolveHandleAndId` compares holders, not identities. `idAgrees` is `true`
when the handle and the saved id resolve to the same holder, and that holder
is not zero. So:

| What happened since you saved the id | `holder` | `idAgrees` |
| --- | --- | --- |
| Nothing | the same address | `true` |
| The identity moved to a new address | the new address | `true` |
| Another identity, at another address, took the handle | the new address | `false` |
| The identity switched to a new handle, and nobody holds this one | zero | `false` |
| Another identity at the same address took the handle | the same address | `true` |

The last row is the one it cannot see: the payment still goes to the same
address, but through a different identity.

Only use this with an id you saved earlier. An id you read just now always
agrees, so the check tells you nothing. If your app has nothing saved, show
`observedAt` from the section above instead.

What to do with `false` depends on what the user asked for:

- "Pay whoever holds @octocat now." The payment is right. Tell the user the
  handle changed holder, and send.
- "Pay the person I paid last time." The handle no longer leads to them.
  Stop and ask the user before sending.

## From Solidity

`IdentityRegistry` answers the same calls from a contract. See
[Gate a contract](/docs/guides/gate-contract/).
