---
title: Published handles
description: The one handle a holder shows on each platform, and every identity it has.
sidebar:
  order: 4
---

A holder can have several identities. To show it under one name, a holder
can publish one handle per platform.

A binding stores nodes, not text, so a handle is on chain only if its holder
discloses it. Publishing is how a holder discloses it.

## Publishing

```solidity
function bind(bytes32 platformId, uint16 verifierVersion, bytes payload, string handle) payable
function bindPrivately(bytes32 platformId, uint16 verifierVersion, bytes payload) payable
function publish(bytes32 platformId, string handle)
function unpublish(bytes32 platformId)
```

There are two ways to publish:

- Pass the handle to `bind`. Lowercased and hashed, it must give the handle
  node the proof binds, or the bind reverts with `HandleNotProved`.
- Call `publish` later. It needs no new proof, only the handle text. The
  caller must hold that handle, or it reverts with `NotYourHandle`.

```ts
import { calls, platformId } from '@libid/contracts';

const call = calls.identityRegistry.publish(IDENTITY_REGISTRY, platformId('github'), 'octocat');
// { to, data }: send it from the address that holds octocat.
```

`IDENTITY_REGISTRY` is the registry's address; see
[Addresses](/docs/reference/addresses/).

Either way the registry stores the handle lowercased and emits
`HandlePublished` with it. It replaces the holder's earlier published handle
on that platform.

`bindPrivately`, or `bind` with an empty handle, discloses nothing and leaves
the published handle as it was.

`unpublish(platformId)` removes the published handle, if there is one, and
emits `HandleUnpublished`. The binding stays.

When a holder stops holding its published handle, because it renamed, someone
else proved the handle, or the identity moved to another address, the
registry removes the published handle and emits `HandleUnpublished`.

A disclosure is permanent. `unpublish` clears the registry's state, but the
transaction that carried the handle stays in the chain's history. So does the
calldata of a `bind` or `publish` that reverted.

## Reading it

```solidity
function publishedHandleOf(address holder, bytes32 platformId) view returns (string)
```

`publishedHandleOf` returns the handle only while it still resolves to that
holder. If someone else has taken the handle, it returns an empty string, so
you never show a handle the holder has lost.

This is the check ENS asks its integrators to do themselves for reverse
records. Here the contract does it.

## Published handle or all identities

| You want | Use |
| --- | --- |
| One name to show next to an address | `publishedHandleOf` |
| Every identity an address holds | `identitiesOf`, which returns nodes, not handles |

See [Look up a wallet](/docs/guides/lookup-wallet/).

ENS names under `handles.link` resolve from name to address only. An address
has no ENS reverse record.
