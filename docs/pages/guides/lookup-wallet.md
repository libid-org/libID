---
title: Look up a wallet
description: Find the handle a wallet shows, and every identity it holds.
sidebar:
  order: 1
---

A wallet can hold several identities, on one platform or on many. This guide
shows how to get the one handle a wallet shows as its name, and how to list
all of its identities.

The examples use this setup. The holder is the address behind `testyakly` on
[Sepolia](/docs/networks/sepolia/):

```js
import { createPublicClient, http } from 'viem';
import { identityCount, identitiesOf, platformId, primaryHandleOf } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const registry = { client, address: process.env.IDENTITY_REGISTRY };

const holder = '0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c';
```

## Show a handle

To show a wallet by its handle in your app, use `primaryHandleOf`:

```js
const primary = await primaryHandleOf(registry, holder);
console.log(primary?.handle ?? holder);
```

Each holder has at most one primary handle, on any platform.
`primaryHandleOf` returns it with its `platformId`, or `null` if the holder
has not chosen one. It also returns `null` if the handle now belongs to
someone else, so you never show a handle the holder has lost. See
[Primary handle](/docs/concepts/primary-handle/).

## List every identity

`identitiesOf` returns the identities a holder has, on every platform, one
page at a time. `identityCount` tells you how many there are:

```js
const count = await identityCount(registry, holder);
const identities = await identitiesOf(registry, holder, 0n, 10n);

for (const identity of identities) {
  console.log(identity.platformId, identity.idNode, identity.handleNode, identity.handleCurrent);
}
```

Each identity has:

- `platformId`: the platform, as `platformId('github')` computes it.
- `idNode`: the node of the id the platform issued, a SHA-256 hash of the
  id. It never changes.
- `handleNode`: the node of the handle this identity proved most recently.
- `handleCurrent`: `false` if another identity has since proved the same
  handle. Do not route payments by a handle when this is `false`.

The list has nodes, not the id or the handle as text. See
[Platforms and nodes](/docs/concepts/platforms-and-nodes/#nodes). To show a
handle, use `primaryHandleOf`. To check whether an identity proved a handle
you already know, compare its `handleNode` with
`handleNode('github', 'testyakly')` from `@libid/contracts`.

The arguments after the holder are where the page starts and how many
identities to return. To read a long list, move the start forward:

```js
const all = [];
for (let from = 0n; from < count; from += 10n) {
  all.push(...(await identitiesOf(registry, holder, from, 10n)));
}
```

The order of the list is not fixed. It can change when an identity moves to
another holder. If you need an exact list, read the count and all pages at
the same block.

## One platform only

The list covers all platforms. To keep one, filter it:

```js
const onGithub = all.filter((i) => i.platformId === platformId('github'));
```
