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
  handleNode,
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
const holder = await resolveHandle(registry, github, 'testyakly');
```

You get the holder that proved the handle most recently, or `null`.

Only A-Z are folded to a-z, so `TestYakly` finds `testyakly`. Nothing else
changes: `@testyakly` and `testyakly` are different handles. Nobody can prove
`@testyakly` or `test yakly`, so they return `null`. If your users type a leading
`@` or spaces, remove them yourself.

`resolveHandle` hashes the handle locally and sends only the hash to the RPC.

If the platform id is not GitHub, X or Google, the call reverts with
`UnknownPlatform`. A typo in the platform key shows up as an error, not as an
empty result.

## See when it was proved

A binding records the time the platform confirmed it. Read it with
`handleNode` and `handleBinding`:

```js
const node = handleNode('github', 'testyakly');

const [current, observedAt] = await client.readContract({
  address: registry.address,
  abi: identityRegistryAbi,
  functionName: 'handleBinding',
  args: [node],
});

console.log(current, new Date(Number(observedAt) * 1000));
```

`handleNode` turns a platform key and a handle into the `bytes32` key the
contract stores it under. It throws `HandleError` for text that can never be
a handle. `handleBinding` returns the holder of that key and `observedAt`, a
Unix time in seconds.

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
`@testyakly` last month may now be paying a stranger.

The contract cannot tell you this on its own. Your app has to remember who
held the handle before. When a user first pays or saves a handle, store the
id node of the identity behind it:

```js
async function idNodeOf(holder, platformKey, handle) {
  if (!holder) return null;
  const node = handleNode(platformKey, handle);
  const count = await identityCount(registry, holder);
  for (let from = 0n; from < count; from += 10n) {
    for (const i of await identitiesOf(registry, holder, from, 10n)) {
      if (i.handleNode === node && i.handleCurrent) return i.idNode;
    }
  }
  return null;
}

const savedIdNode = await idNodeOf(holder, 'github', 'testyakly'); // keep this with the contact
```

`idNodeOf` reads the holder's identities a page at a time and returns the id
node of the one that holds the handle now. It returns `null` if nobody holds
the handle. The list has nodes, not handle text, so it compares the handle's
node.

Next time, pass the saved id node to `resolveHandleAndId`:

```js
if (savedIdNode) {
  const { holder: now, idAgrees } = await resolveHandleAndId(registry, github, 'testyakly', savedIdNode);
  if (!idAgrees) {
    console.log('@testyakly now belongs to a different account.');
  }
}
```

`idAgrees` is `true` when the identity behind the saved id node is the one
that last proved the handle, and the handle has a holder. So:

| What happened since you saved the id | `holder` | `idAgrees` |
| --- | --- | --- |
| Nothing | the same address | `true` |
| The identity moved to a new address | the new address | `true` |
| Another identity, at another address, took the handle | the new address | `false` |
| The identity switched to a new handle, and nobody holds this one | zero | `false` |
| Another identity at the same address took the handle | the same address | `false` |

In the last row the payment still goes to the same address, but through a
different identity.

Only use this with an id node you saved earlier. One you read just now always
agrees, so the check tells you nothing. If your app has nothing saved, show
`observedAt` from the section above instead.

What to do with `false` depends on what the user asked for:

- "Pay whoever holds @testyakly now." The payment is right. Tell the user the
  handle changed holder, and send.
- "Pay the person I paid last time." The handle no longer leads to them.
  Stop and ask the user before sending.

## From Solidity

`IdentityRegistry` answers the same calls from a contract. See
[Gate a contract](/docs/guides/gate-contract/).
