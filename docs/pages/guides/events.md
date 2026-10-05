---
title: Listen to events
description: Follow new bindings and escrow payments as they happen.
sidebar:
  order: 5
---

`IdentityRegistry` emits an event every time an address proves an identity.
`HandleEscrow` emits one for every payment. You can read past events or watch
for new ones.

The examples use this setup:

```js
import { createPublicClient, http } from 'viem';
import { handleEscrowAbi, identityRegistryAbi, platformId } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY;
```

## Read past bindings

```js
const bound = await client.getContractEvents({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
  fromBlock: 0n,
});

for (const { args } of bound) {
  console.log(args.holder, args.handle, args.id);
}
```

Many RPC providers limit how many blocks one request can cover. On a real
network, set `fromBlock` and `toBlock` and read in ranges.

`IdentityBound` has these fields:

| Field | Meaning |
| --- | --- |
| `holder` | The address that proved the identity. |
| `platformId` | The platform. |
| `id` | The identity's id. It never changes. |
| `handle` | The handle, normalized: `Alice-Dev` on GitHub is stored as `alice-dev`. |
| `idNode`, `handleNode` | The keys the id and the handle are stored under. |
| `observedAt` | When the platform confirmed the identity, in Unix seconds. |
| `published` | Whether the handle is now the holder's published handle. |

`holder`, `idNode` and `handleNode` are indexed, so you can filter by them:

```js
const forWallet = await client.getContractEvents({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
  args: { holder: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  fromBlock: 0n,
});
```

## Other IdentityRegistry events

- `HandleRetired`: a handle stopped pointing at its holder, because the same
  identity proved a new handle.
- `HandleUnpublished`: a holder stopped showing its published handle on a
  platform.

## Watch for new bindings

```js
const unwatch = client.watchContractEvent({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
  onLogs: (logs) => {
    for (const { args } of logs) console.log('bound', args.handle, args.holder);
  },
});
```

Call `unwatch()` to stop.

## Escrow events

`HandleEscrow` emits:

- `Deposited`: funds are held for a handle nobody owns yet.
- `Forwarded`: the handle had a holder, who was paid right away.
- `Claimed`: the holder took what was held.
- `Refunded`: a deposit's `refundTo` address took it back.

For example, to list the deposits ever made to one handle:

```js
const carolNode = await client.readContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: 'handleNodeOf',
  args: [platformId('github'), 'carol'],
});

const deposits = await client.getContractEvents({
  address: process.env.HANDLE_ESCROW,
  abi: handleEscrowAbi,
  eventName: 'Deposited',
  args: { handleNode: carolNode },
  fromBlock: 0n,
});
```

`Deposited` events tell you what was sent, not what is left. Refunds and
claims take funds out. To show what a holder can claim now, read
`escrowed(handleNode, token)` for each token.

Anyone can create a token and deposit it, so do not trust a token just because
it appears in `Deposited`. Show only the tokens you know.

## Keep an index in sync

If you store events in your own database, follow these rules:

- Read history in block ranges, then switch to watching. Start the watch from
  the block after the last range you read, so you miss nothing.
- Save the last block you processed. After a restart or a dropped
  connection, read from that block again instead of trusting the watcher to
  catch up.
- Handle the same event twice without harm. Key each event by its
  transaction hash and log index.
- Blocks near the head can be replaced (a reorg). Either wait a few blocks
  before you treat an event as final, or drop and re-read events from blocks
  that changed. viem marks a removed log with `removed: true`.
- Apply events in order: by block number, then log index.
- On `IdentityBound`, set the holder of `handleNode` and of `idNode` to
  `holder`. If `published` is `true`, set `holder`'s published handle on
  `platformId` to `handle`. If it is `false`, leave the published handle
  as it is.
- On `HandleRetired`, mark `handleNode` as held by nobody. An identity emits it
  when it proves a new handle. If you skip it, your index keeps routing the
  old handle to that holder.
- On `HandleUnpublished`, clear the holder's published handle on that
  platform.
- When you show a published handle, check that your index still has its
  `handleNode` held by the same holder. If someone else has proved the
  handle since, or it was retired, show nothing. No event clears the
  published handle in that case. `publishedHandleOf` makes the same check.
