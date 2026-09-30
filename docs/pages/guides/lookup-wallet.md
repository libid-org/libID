---
title: Look up a wallet
description: Find the name a wallet shows, and every account it owns.
sidebar:
  order: 1
---

A wallet can prove several accounts, on one platform or on many. This guide
shows how to get the one name a wallet wants to show, and how to list all of
its accounts.

The examples use this setup:

```js
import { createPublicClient, http } from 'viem';
import { accountCount, accountsOf, platformId, primaryName } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const names = { client, address: process.env.IDENTITY_NAMES };

const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
```

## Show a name

To show a wallet as a name in your app, use `primaryName`:

```js
const name = await primaryName(names, wallet, platformId('github'));
console.log(name ?? wallet);
```

Each wallet picks at most one name per platform. `primaryName` returns it, or
`null` if the wallet has not picked one. It also returns `null` if the name
now belongs to someone else, so you never show a name the wallet has lost.

## List every account

`accountsOf` returns the accounts a wallet owns, on every platform, one page
at a time. `accountCount` tells you how many there are:

```js
const count = await accountCount(names, wallet);
const accounts = await accountsOf(names, wallet, 0n, 10n);

for (const account of accounts) {
  console.log(account.platformId, account.userId, account.handle, account.handleCurrent);
}
```

Each account has:

- `platformId`: the platform, as `platformId('github')` computes it.
- `userId`: the account id the platform issued. It never changes. For
  Google it is `0x` and a SHA-256 digest of the Google account id, so the
  real id never reaches the chain.
- `handle`: the handle this account proved most recently.
- `handleCurrent`: `false` if another account has since proved the same
  handle. Do not route payments by a handle when this is `false`.

The arguments after the wallet are where the page starts and how many
accounts to return. To read a long list, move the start forward:

```js
const all = [];
for (let from = 0n; from < count; from += 10n) {
  all.push(...(await accountsOf(names, wallet, from, 10n)));
}
```

The order of the list is not fixed. It can change when an account moves to
another wallet. If you need an exact list, read the count and all pages at the
same block.

## One platform only

The list covers all platforms. To keep one, filter it:

```js
const githubAccounts = all.filter((a) => a.platformId === platformId('github'));
```
