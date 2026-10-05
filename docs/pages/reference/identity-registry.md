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

The holder that last proved the handle, or the zero address. The handle is
normalized first, so you can pass what a user typed. Text that can never be a
handle returns the zero address. Reverts `UnknownPlatform` if the platform is
not set up.

### resolveId

```solidity
function resolveId(bytes32 platformId, string id) view returns (address)
```

The holder of the identity with this id, or the zero address. Reverts
`UnknownPlatform` if the platform is not set up.

### resolveHandleAndId

```solidity
function resolveHandleAndId(bytes32 platformId, string handle, string id)
    view returns (address holder, bool idAgrees)
```

`holder` is what `resolveHandle` returns. `idAgrees` is `true` when
`resolveId(platformId, id)` returns the same, non-zero holder. Use it with an
id you saved earlier; see
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-holder).

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

### publishedHandleOf

```solidity
function publishedHandleOf(address holder, bytes32 platformId) view returns (string)
```

The handle the holder chose to show on the platform. Empty if it chose none,
or if the handle now resolves to a different holder.

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
    string id;
    string handle;
    bool handleCurrent;
}
```

A page of the holder's identities, from index `from`, at most `limit` long.
`handle` is the handle the identity proved most recently. `handleCurrent` is
`false` once another identity has proved that handle. The order is not fixed
and can change when an identity moves to another holder. Each identity costs
about six storage reads, so keep `limit` small when you call this from a
contract.

## Handles and rules

### handleNodeOf

```solidity
function handleNodeOf(bytes32 platformId, string handle) view returns (bytes32)
```

The `handleNode` of a handle, after normalizing it. Reverts `UnknownPlatform`
or `UnusableHandle`.

### handleHashOf

```solidity
function handleHashOf(bytes32 platformId, string handle) view returns (bytes32)
```

`keccak256` of the normalized handle. This is the hash `HandleEscrow.deposit`
takes. Reverts like `handleNodeOf`. Calling it over RPC sends the handle to
your RPC provider; the TypeScript package computes it locally.

### handleNodeOfHash

```solidity
function handleNodeOfHash(bytes32 platformId, bytes32 handleHash) pure returns (bytes32)
```

The `handleNode` for a handle hash. It does not check that the hash came from
a real handle.

### rulesOf

```solidity
function rulesOf(bytes32 platformId) view returns (Rules memory)

struct Rules {
    uint16 maxLength;
    bool stripLeadingAt;
    bool isEmail;
    bool allowUnderscore;
    bool allowHyphen;
}
```

How the platform normalizes handles. Reverts `UnknownPlatform`.

### acceptsBindings

```solidity
function acceptsBindings(bytes32 platformId) view returns (bool)
```

Whether `bind` can bind an identity on the platform right now.

## Binding

A holder binds an identity by calling `bind` with a proof. Your app normally
does not build this call by hand; the libID sign-in flow does. See
[How binding works](/docs/advanced/how-binding-works/).

### bind

```solidity
function bind(bytes32 platformId, uint16 verifierVersion, bytes payload, bool publish) payable
```

Verifies the proof and binds the identity and its handle to the caller.
`publish` makes the handle the caller's published handle on that platform.
Send `quoteBind(platformId, verifierVersion)` as `msg.value`, plus any service
fee the proof names.

### quoteBind

```solidity
function quoteBind(bytes32 platformId, uint16 verifierVersion) view returns (uint256)
```

What verifying a proof costs, in wei. It does not include a service fee an
app may charge.

### unpublish

```solidity
function unpublish(bytes32 platformId)
```

Stops showing the caller's published handle on the platform. The binding
stays. Past `IdentityBound` events still contain the handle.

### digestSpent

```solidity
function digestSpent(bytes32 digest) view returns (bool)
```

Whether a proof with this authorization digest was already used.

## Events

```solidity
event IdentityBound(
    address indexed holder,
    bytes32 indexed idNode,
    bytes32 indexed handleNode,
    bytes32 platformId,
    string id,
    string handle,
    uint64 observedAt,
    bool published,
    uint16 ceremonyVersion
);
```

A holder proved an identity. `handle` is normalized. `published` says whether
the handle is now the holder's published handle.

```solidity
event HandleRetired(bytes32 indexed platformId, bytes32 indexed handleNode, address indexed holder);
```

An identity proved a new handle, so its old handle stopped resolving.

```solidity
event HandleUnpublished(address indexed holder, bytes32 indexed platformId);
```

A holder stopped showing its published handle on a platform.

Other events are for operators: `CeremonyBound` and `BindFeePaid` (emitted
by `bind`), `PlatformConfigured`, `ProofVerifierConfigured`, and the standard
ownership and upgrade events.

## Errors you may see

| Error | When |
| --- | --- |
| `UnknownPlatform(bytes32 platformId)` | The platform is not set up on this network. |
| `UnusableHandle(uint8 problem)` | The text can never be a handle. `problem` is 1 empty, 2 too long, 3 bad character, 4 bad shape. |
| `StaleProof(uint64 observedAt, uint64 known)` | A newer proof already exists for this identity or handle. |
| `NotProofTarget(address proved, address caller)` | The proof was made for a different holder. |
| `DigestAlreadySpent(bytes32 digest)` | The proof was already used. |
| `WrongBindValue(uint256 required, uint256 provided)` | `msg.value` is less than `quoteBind`. |
| `WrongFeeValue(uint256 required, uint256 provided)` | The extra value does not match the service fee in the proof. |

## Admin functions

The owner of the contract can call `setPlatform`, `setProofVerifier`,
`upgradeToAndCall` and the ownership functions. See
[What a binding proves](/docs/concepts/trust/) for what this means for you.
