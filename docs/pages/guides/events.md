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
import { handleEscrowAbi, handleNode, identityRegistryAbi } from '@libid/contracts';

const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY;
const FROM_BLOCK = BigInt(process.env.FROM_BLOCK ?? 0);

// Read events from FROM_BLOCK to the latest block, 5000 blocks at a time.
async function readEvents(filter) {
  const latest = await client.getBlockNumber();
  const events = [];
  for (let from = FROM_BLOCK; from <= latest; from += 5000n) {
    const to = from + 4999n < latest ? from + 4999n : latest;
    events.push(...(await client.getContractEvents({ ...filter, fromBlock: from, toBlock: to })));
  }
  return events;
}
```

`FROM_BLOCK` is the block the contracts were deployed in. Nothing happened
before it, so do not read earlier blocks. Each network's page gives it; see
[Eden](/docs/networks/eden/). On a local chain, leave it unset to
start from block 0.

Most RPC providers limit how many blocks one request can cover, so
`readEvents` reads in ranges. Free public RPCs may also refuse log requests
for older blocks, sometimes only on some attempts. For a reliable index, use
an RPC that keeps the full history.

## Read past bindings

```js
const bound = await readEvents({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
});

for (const { args } of bound) {
  console.log(args.holder, args.platformId, args.handleNode, args.idNode);
}
```

`IdentityBound` has these fields:

| Field | Meaning |
| --- | --- |
| `holder` | The address that proved the identity. |
| `platformId` | The platform. |
| `idNode`, `handleNode` | The keys the id and the handle are stored under, SHA-256 hashes of each. |
| `observedAt` | When the platform confirmed the identity, in Unix seconds. |
| `ceremonyVersion` | The ceremony version the proof used. |

The event has no id or handle as text. If the holder discloses the handle,
the registry emits `HandleRevealed` with it, in the same transaction or
later.

`holder`, `idNode` and `handleNode` are indexed, so you can filter by them:

```js
const forWallet = await readEvents({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
  args: { holder: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
});
```

## Other IdentityRegistry events

- `HandleRetired`: a handle stopped pointing at its holder, because the same
  identity proved a new handle.
- `HandleRevealed`: a handle's text went on chain, with A-Z folded to a-z.
  It has the platform and the handle node, and no address. `bind` with a
  handle, `publish` and `reveal` emit it.
- `HandlePublished`: a holder made a handle its primary handle. It has the
  holder, the platform and the handle node, not the text. It replaces the
  holder's earlier primary handle, on any platform.
- `HandleUnpublished`: a holder's primary handle was removed, by `unpublish`
  or because the holder lost that handle, to another identity or by
  retiring it.

## Watch for new bindings

```js
const unwatch = client.watchContractEvent({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: 'IdentityBound',
  onLogs: (logs) => {
    for (const { args } of logs) console.log('bound', args.handleNode, args.holder);
  },
});
```

Call `unwatch()` to stop.

## Escrow events

`HandleEscrow` emits:

- `Deposited`: funds are held for a handle nobody owns yet. It names the
  `sender` and the `refundableAt` of the sender's whole contribution.
- `HandleRevealed`: a `depositToHandle` named the handle as text. It is the
  same event the registry emits, and comes with a `Deposited` or a
  `Forwarded`.
- `Forwarded`: the handle had a holder, who was paid right away.
- `Claimed`: the holder took what was held.
- `Refunded`: a sender took its deposits back.

For example, to list the deposits ever made to one handle:

```js
const carolNode = handleNode('github', 'carol');

const deposits = await readEvents({
  address: process.env.HANDLE_ESCROW,
  abi: handleEscrowAbi,
  eventName: 'Deposited',
  args: { handleNode: carolNode },
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
  `holder`.
- On `HandleRevealed`, from the registry or the escrow, save `handle` as
  the text of `handleNode`. This is the only event with handle text.
- On `HandlePublished`, set `holder`'s primary handle to `handleNode` on
  `platformId`, replacing any earlier one. Take the text from
  `HandleRevealed`.
- On `HandleRetired`, mark `handleNode` as held by nobody. An identity emits it
  when it proves a new handle. If you skip it, your index keeps routing the
  old handle to that holder.
- On `HandleUnpublished`, clear the holder's primary handle.
- When a holder loses the handle its primary handle shows, the registry
  emits `HandleUnpublished`. `HandlePublished` and `HandleUnpublished` are
  enough to keep the primary handle right. `primaryHandleOf` also checks
  that the holder still holds the handle.
