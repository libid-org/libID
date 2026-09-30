---
title: Listen to events
description: Follow new bindings and escrow payments as they happen.
sidebar:
  order: 5
---

`IdentityNames` emits an event every time a wallet proves an account.
`HandleEscrow` emits one for every payment. You can read past events or watch
for new ones.

The examples use this setup:

```js
import { createPublicClient, http } from 'viem';
import { handleEscrowAbi, identityNamesAbi } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const IDENTITY_NAMES = '0xe78b53a183dd51763df44beb2500ddab9bb0329e';
```

## Read past bindings

```js
const bound = await client.getContractEvents({
  address: IDENTITY_NAMES,
  abi: identityNamesAbi,
  eventName: 'IdentityBound',
  fromBlock: 0n,
});

for (const { args } of bound) {
  console.log(args.owner, args.handle, args.userId);
}
```

Many RPC providers limit how many blocks one request can cover. On a real
network, set `fromBlock` and `toBlock` and read in ranges.

`IdentityBound` has these fields:

| Field | Meaning |
| --- | --- |
| `owner` | The wallet that proved the account. |
| `platformId` | The platform. |
| `userId` | The account id. It never changes. |
| `handle` | The handle, normalized: `Alice-Dev` on GitHub is stored as `alice-dev`. |
| `idNode`, `handleNode` | The keys the account and the handle are stored under. |
| `observedAt` | When the platform confirmed the account, in Unix seconds. |
| `published` | Whether the handle is now the wallet's shown name. |

`owner`, `idNode` and `handleNode` are indexed, so you can filter by them:

```js
const forWallet = await client.getContractEvents({
  address: IDENTITY_NAMES,
  abi: identityNamesAbi,
  eventName: 'IdentityBound',
  args: { owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  fromBlock: 0n,
});
```

## Other IdentityNames events

- `HandleRetired`: a handle stopped pointing at its owner, because the same
  account proved a new handle.
- `NameUnpublished`: a wallet stopped showing its name on a platform.

## Watch for new bindings

```js
const unwatch = client.watchContractEvent({
  address: IDENTITY_NAMES,
  abi: identityNamesAbi,
  eventName: 'IdentityBound',
  onLogs: (logs) => {
    for (const { args } of logs) console.log('bound', args.handle, args.owner);
  },
});
```

Call `unwatch()` to stop.

## Escrow events

`HandleEscrow` emits:

- `Deposited`: funds are held for a handle nobody owns yet.
- `Forwarded`: the handle had an owner, who was paid right away.
- `Claimed`: the owner took what was held.
- `Refunded`: a sender took a deposit back.

For example, to list what is waiting for one handle:

```js
const deposits = await client.getContractEvents({
  address: process.env.HANDLE_ESCROW,
  abi: handleEscrowAbi,
  eventName: 'Deposited',
  args: { handleNode: '0x…' },
  fromBlock: 0n,
});
```

Anyone can create a token and deposit it, so do not trust a token just because
it appears in `Deposited`. Show only the tokens you know.
