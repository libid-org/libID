---
title: IdentityRegistry
description: Functions, events and errors of the contract that stores which holder has which identity.
sidebar:
  order: 1
---

`IdentityRegistry` stores which holder has which identity. It is an
upgradeable proxy with one address on every production network and another
on every testnet. See [Addresses](/docs/reference/addresses/).

Terms used below:

- An identity is a platform account proved to a holder. Its id never
  changes; its handle can.
- The holder is the address an identity is bound to.
- `platformId` is `keccak256` of the platform key: `"github"`, `"x"` or
  `"google"`.
- `idNode` and `handleNode` are the keys an id and a handle are stored under.
  See [Platforms and nodes](/docs/concepts/platforms-and-nodes/).
- `observedAt` is a Unix time in seconds. See
  [Freshness](/docs/concepts/freshness/).

The full source is
[IdentityRegistry.sol](https://github.com/libid-org/libID-contracts/blob/main/solidity/contracts/identity/IdentityRegistry.sol).

## Resolving

### resolveHandle

```solidity
function resolveHandle(bytes32 platformId, string handle) view returns (address)
```

The holder that last proved the handle, or the zero address. Only A to Z
are folded to lowercase; nothing else changes, so `@octocat` is not
`octocat`. Text that can never be a handle returns the zero address.
Reverts `UnknownPlatform` if the platform is not GitHub, X or Google.

### resolveId

```solidity
function resolveId(bytes32 idNode) view returns (address)
```

The holder of the identity with this id node, or the zero address. The
TypeScript package computes the node with `idNode`.

### resolveHandleAndId

```solidity
function resolveHandleAndId(bytes32 platformId, string handle, bytes32 idNode)
    view returns (address holder, bool idAgrees)
```

`holder` is what `resolveHandle` returns. `idAgrees` is `true` when someone
holds the handle and `idNode` is the identity that last proved it. A handle
that moved between two identities of the same holder disagrees with the
earlier one. Use it with an id node you saved earlier; see
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-holder).

### resolveHandleNodeAndId

```solidity
function resolveHandleNodeAndId(bytes32 platformId, bytes32 handleNode, bytes32 idNode)
    view returns (address holder, bool idAgrees)
```

`resolveHandleAndId` with the handle's node instead of its text, so the
handle does not reach your RPC provider. A node of another platform returns
`(0, false)`.

### handleBinding

```solidity
function handleBinding(bytes32 handleNode) view returns (address holder, uint64 observedAt)
```

The holder of the handle and the time of its latest proof. `holder` is zero
if nobody has proved the handle, or if its identity has since proved a
different handle. `observedAt` stays set in that second case.

### idBinding

```solidity
function idBinding(bytes32 idNode) view returns (address holder, uint64 observedAt)
```

The holder of the identity and the time of its latest proof.

## Identities of a holder

### primaryHandleOf

```solidity
function primaryHandleOf(address holder) view returns (bytes32 platformId, string handle)
```

The one handle the holder chose to show as its name, and the platform it is
on. `(0, "")` if it chose none, or if it no longer holds that handle. See
[Primary handle](/docs/concepts/primary-handle/).

### identityCount

```solidity
function identityCount(address holder) view returns (uint256)
```

How many identities the holder has, on all platforms.

### identitiesOf

```solidity
function identitiesOf(address holder, uint256 from, uint256 limit)
    view returns (Identity[] memory)

struct Identity {
    bytes32 platformId;
    bytes32 idNode;
    bytes32 handleNode;
    bool handleCurrent;
}
```

A page of the holder's identities, from index `from`, at most `limit` long.
`handleNode` is the node of the handle the identity proved most recently.
`handleCurrent` is `false` once another identity has proved that handle. The
order is not fixed and can change when an identity moves to another holder. Each identity costs
about four storage reads, so keep `limit` small when you call this from a
contract.

## Handles

### handleNodeOf

```solidity
function handleNodeOf(bytes32 platformId, string handle) pure returns (bytes32 handleNode)
```

The `handleNode` of a handle: A to Z folded to lowercase, then hashed under
the platform's tag. It does not check that the text could be a handle.
Reverts `UnknownPlatform`. Calling it over RPC sends the handle to your RPC
provider; the TypeScript package computes it locally.

### acceptsBindings

```solidity
function acceptsBindings(bytes32 platformId) view returns (bool)
```

Whether `bind` can bind an identity on the platform right now. Reverts
`UnknownPlatform` if the platform is not GitHub, X or Google.

### nodeKeyed

```solidity
function nodeKeyed() pure returns (bool)
```

Always `true`: the registry stores bindings under SHA-256 nodes.
`HandleEscrow` checks it when it is set up.

## Binding

A holder binds an identity by calling `bind` with a proof. Your app normally
does not build this call by hand; the libID sign-in flow does. See
[How binding works](/docs/advanced/how-binding-works/).

### bind

```solidity
function bind(
    bytes32 platformId,
    uint16 verifierVersion,
    bytes payload,
    string handle,
    bool primary,
    uint256 feeAmount,
    address feeReceiver
) payable
```

Verifies the proof and binds the identity and its handle to the caller.

A nonempty `handle` is disclosed: it must fold and hash to the handle node
the proof bound, or the call reverts `HandleNotProved`, and it is logged in
`HandleRevealed`. With `primary` set, it also becomes the caller's primary
handle. An empty `handle` discloses nothing; `primary` with an empty handle
reverts `PrimaryWithoutHandle`.

`feeAmount` is a service fee that goes to `feeReceiver`. A bind with no fee
passes `(0, address(0))`. Send `quoteBind(platformId, verifierVersion)` plus
`feeAmount` as `msg.value`, exactly.

### bindPrivately

```solidity
function bindPrivately(
    bytes32 platformId, uint16 verifierVersion, bytes payload, uint256 feeAmount, address feeReceiver
) payable
```

`bind` with an empty handle. The registry stores only the nodes.

### quoteBind

```solidity
function quoteBind(bytes32 platformId, uint16 verifierVersion) view returns (uint256)
```

What verifying a proof costs, in wei. It does not include the service fee
passed to `bind`.

### publish

```solidity
function publish(bytes32 platformId, string handle)
```

Makes `handle` the caller's primary handle, replacing the one it had on any
platform. Its node must be one the caller holds, or the call reverts
`NotYourHandle`. Emits `HandleRevealed`, then `HandlePublished`.

### reveal

```solidity
function reveal(bytes32 platformId, string handle)
```

Shows a handle the caller holds in `HandleRevealed`, without making it the
primary handle. It changes no state. Reverts `NotYourHandle` like `publish`.

### unpublish

```solidity
function unpublish()
```

Removes the caller's primary handle, whatever its platform. The bindings
stay, and so do past `HandleRevealed` logs with the handle's text.

### digestSpent

```solidity
function digestSpent(bytes32 digest) view returns (bool)
```

Whether a proof with this authorization digest was already used here. The
digest names no chain, so the same proof can bind once on each chain that
runs the verifier.

## Events

```solidity
event IdentityBound(
    address indexed holder,
    bytes32 indexed idNode,
    bytes32 indexed handleNode,
    bytes32 platformId,
    uint64 observedAt,
    uint16 ceremonyVersion
);
```

A holder proved an identity. It carries only the nodes.

```solidity
event HandleRevealed(bytes32 indexed platformId, bytes32 indexed handleNode, string handle);
```

A call put a handle's text on chain: `bind` with a handle, `publish` or
`reveal`. `handle` is folded. It is the only registry event with handle
text. `HandleEscrow` emits the same event.

```solidity
event HandlePublished(address indexed holder, bytes32 indexed platformId, bytes32 indexed handleNode);
```

A holder made a handle its primary handle, with `bind` and `primary`, or
`publish`. It replaces any earlier one without a `HandleUnpublished`. The
text is in the `HandleRevealed` just before it.

```solidity
event HandleRetired(bytes32 indexed platformId, bytes32 indexed handleNode, address indexed holder);
```

An identity proved a new handle, so its old handle stopped resolving.

```solidity
event HandleUnpublished(address indexed holder);
```

A holder's primary handle was removed: by `unpublish`, or because the holder
no longer holds that handle.

Other events are for operators: `CeremonyBound` and `BindFeePaid` (emitted
by `bind`), `ProofVerifierConfigured`, and the standard
ownership and upgrade events.

## Errors you may see

| Error | When |
| --- | --- |
| `UnknownPlatform(bytes32 platformId)` | The platform is not GitHub, X or Google. |
| `HandleNotProved(bytes32 disclosed, bytes32 proved)` | The handle passed to `bind` is not the one the proof bound. |
| `PrimaryWithoutHandle()` | `bind` was given `primary` with an empty handle. |
| `NotYourHandle(bytes32 handleNode)` | `publish` or `reveal` was given a handle the caller does not hold. |
| `StaleProof(uint64 observedAt, uint64 known)` | A newer proof already exists for this identity or handle. |
| `NotProofTarget(address proved, address caller)` | The proof was made for a different holder. |
| `DigestAlreadySpent(bytes32 digest)` | The proof was already used. |
| `WrongBindValue(uint256 required, uint256 provided)` | `msg.value` is less than `quoteBind`. |
| `WrongFeeValue(uint256 required, uint256 provided)` | The value above `quoteBind` is not `feeAmount`. |
| `NoncanonicalFee(uint256 amount, address receiver)` | Only one of `feeAmount` and `feeReceiver` is zero. |
| `FeeTransferFailed(address receiver, uint256 amount)` | `feeReceiver` refused the fee. |

## Admin functions

The owner of the contract can call `setProofVerifier`, `upgradeToAndCall`
and the ownership functions. See
[What a binding proves](/docs/concepts/trust/) for what this means for you.
