---
title: Look up a wallet
description: Find the handle a wallet shows, and every identity it holds.
sidebar:
  order: 1
---

A wallet can hold several identities, on one platform or on many. This guide
shows how to get the one handle a wallet publishes, and how to list all of
its identities.

The examples use this setup:

```js
import { createPublicClient, http } from 'viem';
import { identityCount, identitiesOf, platformId, publishedHandleOf } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const registry = { client, address: process.env.IDENTITY_REGISTRY };

const holder = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
```

## Show a handle

To show a wallet by its handle in your app, use `publishedHandleOf`:

```js
const handle = await publishedHandleOf(registry, holder, platformId('github'));
console.log(handle ?? holder);
```

Each holder publishes at most one handle per platform. `publishedHandleOf`
returns it, or `null` if the holder has not published one. It also returns
`null` if the handle now belongs to someone else, so you never show a handle
the holder has lost.

## List every identity

`identitiesOf` returns the identities a holder has, on every platform, one
page at a time. `identityCount` tells you how many there are:

```js
const count = await identityCount(registry, holder);
const identities = await identitiesOf(registry, holder, 0n, 10n);

for (const identity of identities) {
  console.log(identity.platformId, identity.id, identity.handle, identity.handleCurrent);
}
```

Each identity has:

- `platformId`: the platform, as `platformId('github')` computes it.
- `id`: the id the platform issued. It never changes. For Google it is
  `SHA256("libid.google-user-id" || sub)` as `0x` and 64 lowercase hex
  digits, so Google's own id never reaches the chain. See
  [Platforms and nodes](/docs/concepts/platforms-and-nodes/#ids-and-handles).
- `handle`: the handle this identity proved most recently.
- `handleCurrent`: `false` if another identity has since proved the same
  handle. Do not route payments by a handle when this is `false`.

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
