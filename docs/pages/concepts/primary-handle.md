---
title: Primary handle
description: The one handle a wallet shows as its name, and how a handle's text reaches the chain.
sidebar:
  order: 4
---

A wallet can hold many identities, on one platform or on several. To show it
under one name, the wallet picks one handle it holds as its primary handle.
A wallet has at most one primary handle across all platforms, like an ENS
primary name.

A binding stores nodes, not text. So a handle's text is on chain only if its
holder discloses it.

## Reading it

```solidity
function primaryHandleOf(address holder) view returns (bytes32 platformId, string handle)
```

```ts
import { primaryHandleOf } from '@libid/contracts';

const primary = await primaryHandleOf(registry, holder);
// { platformId, handle } or null
```

`primaryHandleOf` returns the handle and the platform it is on. It returns
nothing if the holder has no primary handle, or if the holder no longer
holds that handle. So you never show a handle the holder has lost.

This is the check ENS asks its integrators to do themselves for reverse
records. Here the contract does it.

## Disclosing a handle

```solidity
function bind(
    bytes32 platformId, uint16 verifierVersion, bytes payload,
    string handle, bool primary, uint256 feeAmount, address feeReceiver
) payable
function bindPrivately(bytes32 platformId, uint16 verifierVersion, bytes payload, uint256 feeAmount, address feeReceiver) payable
function publish(bytes32 platformId, string handle)
function reveal(bytes32 platformId, string handle)
function unpublish()
```

Three calls put a handle's text on chain:

| Call | Makes it the primary handle |
| --- | --- |
| `bind` with a handle and `primary` set | yes |
| `bind` with a handle, `primary` not set | no |
| `publish(platformId, handle)` | yes |
| `reveal(platformId, handle)` | no |

`bind` checks the handle against the proof. Folded and hashed, it must give
the handle node the proof binds, or the call reverts with `HandleNotProved`.
`primary` with an empty handle reverts with `PrimaryWithoutHandle`.

`publish` and `reveal` need no new proof, only the handle text. The caller
must hold that handle, or the call reverts with `NotYourHandle`. `reveal`
changes no state: it only shows the handle.

```ts
import { calls, platformId } from '@libid/contracts';

const call = calls.identityRegistry.publish(IDENTITY_REGISTRY, platformId('github'), 'octocat');
// { to, data }: send it from the address that holds octocat.
```

`IDENTITY_REGISTRY` is the registry's address; see
[Addresses](/docs/reference/addresses/).

Every call that carries a handle's text emits `HandleRevealed` with the
handle folded. A new primary handle also emits `HandlePublished`, which has
the handle node but no text. It replaces the holder's primary handle on any
platform.

`bindPrivately`, or `bind` with an empty handle, discloses nothing and
leaves the primary handle as it was.

## Removing it

`unpublish()` removes the caller's primary handle, whatever its platform,
and emits `HandleUnpublished`. The bindings stay.

The registry also removes it when the holder stops holding that handle: the
identity renamed, someone else proved the handle, or the identity moved to
another address. Losing a handle on one platform does not remove a primary
handle on another.

## A disclosure is permanent

`unpublish` clears only the primary handle. The handle's text stays in the
`HandleRevealed` log and in the transaction that carried it. So does the
calldata of a `bind`, `publish` or `reveal` that reverted. Paying a handle by
its text with `HandleEscrow.depositToHandle` discloses it too.

A handle that was never disclosed is not secret either. Its node is an
unsalted SHA-256 of a public tag and the handle, so anyone can check a handle
they know or guess. See
[What becomes public](/docs/concepts/trust/#what-becomes-public).

## Primary handle or all identities

| You want | Use |
| --- | --- |
| One name to show next to an address | `primaryHandleOf` |
| Every identity an address holds | `identitiesOf`, which returns nodes, not handles |

See [Look up a wallet](/docs/guides/lookup-wallet/).

ENS names under `handles.link` resolve from name to address only. An address
has no ENS reverse record.
