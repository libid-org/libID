---
title: IdentityNames
description: Functions, events and errors of the contract that stores who owns which account.
sidebar:
  order: 1
---

`IdentityNames` stores which wallet owns which platform account. It is an
upgradeable proxy at the same address on every network. See
[Addresses](/docs/reference/addresses/).

Types used below:

- `platformId` is `keccak256` of the platform name: `"github"`, `"x"` or
  `"google"`.
- `idNode` and `handleNode` are the keys an account and a handle are stored
  under. See [Platforms and nodes](/docs/concepts/platforms-and-nodes/).
- `observedAt` is a Unix time in seconds. See
  [Freshness](/docs/concepts/freshness/).

The full source is
[IdentityNames.sol](https://github.com/libid-org/libID-contracts/blob/main/solidity/contracts/identity/IdentityNames.sol).

## Resolving

### resolveHandle

```solidity
function resolveHandle(bytes32 platformId, string handle) view returns (address)
```

The wallet that last proved the handle, or the zero address. The handle is
normalized first, so you can pass what a user typed. Text that can never be a
handle returns the zero address. Reverts `UnknownPlatform` if the platform is
not set up.

### resolveId

```solidity
function resolveId(bytes32 platformId, string userId) view returns (address)
```

The wallet that proved the account id, or the zero address. Reverts
`UnknownPlatform` if the platform is not set up.

### resolvePair

```solidity
function resolvePair(bytes32 platformId, string handle, string userId)
    view returns (address wallet, bool idAgrees)
```

`wallet` is what `resolveHandle` returns. `idAgrees` is `true` when
`resolveId(platformId, userId)` returns the same, non-zero wallet. Use it
with an account id you saved earlier; see
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-owner).

### byHandle

```solidity
function byHandle(bytes32 handleNode) view returns (address owner, uint64 observedAt)
```

The wallet that holds the handle and the time of its latest proof. `owner`
is zero if nobody has proved the handle, or if its account has since proved a
different handle. `observedAt` stays set in that second case.

### byId

```solidity
function byId(bytes32 idNode) view returns (address owner, uint64 observedAt)
```

The wallet that owns the account and the time of its latest proof.

## Names for a wallet

### primaryOf

```solidity
function primaryOf(address wallet, bytes32 platformId) view returns (string)
```

The handle the wallet chose to show on the platform. Empty if it chose none,
or if the handle now resolves to a different wallet.

### reverseOf

```solidity
function reverseOf(address wallet, bytes32 platformId) view returns (string)
```

The handle the wallet chose, as stored, without checking that the wallet
still holds it. Use `primaryOf` to show a name.

### accountCount

```solidity
function accountCount(address wallet) view returns (uint256)
```

How many accounts the wallet owns, on all platforms.

### accountsOf

```solidity
function accountsOf(address wallet, uint256 from, uint256 limit)
    view returns (Account[] memory)

struct Account {
    bytes32 platformId;
    string userId;
    string handle;
    bool handleCurrent;
}
```

A page of the wallet's accounts, from index `from`, at most `limit` long.
`handle` is the handle the account proved most recently. `handleCurrent` is
`false` once another account has proved that handle. The order is not fixed
and can change when an account moves to another wallet. Each account costs
about six storage reads, so keep `limit` small when you call this from a
contract.

## Keys and rules

### nodeOf

```solidity
function nodeOf(bytes32 platformId, string handle) view returns (bytes32)
```

The `handleNode` of a handle, after normalizing it. Reverts `UnknownPlatform`
or `UnusableHandle`.

### handleHashOf

```solidity
function handleHashOf(bytes32 platformId, string handle) view returns (bytes32)
```

`keccak256` of the normalized handle. This is the hash `HandleEscrow.deposit`
takes. Reverts like `nodeOf`. Calling it over RPC sends the handle to your RPC
provider; the TypeScript package computes it locally.

### nodeOfHash

```solidity
function nodeOfHash(bytes32 platformId, bytes32 handleHash) pure returns (bytes32)
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

Whether a new proof can be accepted on the platform right now.

## Proving

A wallet binds an account by calling `bind` with a proof. Your app normally
does not build this call by hand; the libID client does. See
[How binding works](/docs/advanced/how-binding-works/).

### bind

```solidity
function bind(bytes32 platformId, uint16 verifierVersion, bytes payload, bool publishName) payable
```

Verifies the proof and binds the account and its handle to the caller.
`publishName` makes the handle the caller's shown name on that platform. Send
`quoteBind(platformId, verifierVersion)` as `msg.value`, plus any service fee
the proof names.

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

Stops showing the caller's name on the platform. The binding stays. Past
`IdentityBound` events still contain the handle.

### digestSpent

```solidity
function digestSpent(bytes32 digest) view returns (bool)
```

Whether a proof with this authorization digest was already used.

## Events

```solidity
event IdentityBound(
    address indexed owner,
    bytes32 indexed idNode,
    bytes32 indexed handleNode,
    bytes32 platformId,
    string userId,
    string handle,
    uint64 observedAt,
    bool published,
    uint16 ceremonyVersion
);
```

A wallet proved an account. `handle` is normalized. `published` says whether
the handle is now the wallet's shown name.

```solidity
event HandleRetired(bytes32 indexed platformId, bytes32 indexed handleNode, address indexed owner);
```

An account proved a new handle, so its old handle stopped resolving.

```solidity
event NameUnpublished(address indexed owner, bytes32 indexed platformId);
```

A wallet stopped showing its name on a platform.

Other events are for operators: `CeremonyBound` and `BindFeePaid` (emitted
by `bind`), `PlatformConfigured`, `ProofVerifierConfigured`, and the standard
ownership and upgrade events.

## Errors you may see

| Error | When |
| --- | --- |
| `UnknownPlatform(bytes32 platformId)` | The platform is not set up on this network. |
| `UnusableHandle(uint8 problem)` | The text can never be a handle. `problem` is 1 empty, 2 too long, 3 bad character, 4 bad shape. |
| `StaleProof(uint64 observedAt, uint64 known)` | A newer proof already exists for this account or handle. |
| `NotProofTarget(address proved, address caller)` | The proof was made for a different wallet. |
| `DigestAlreadySpent(bytes32 digest)` | The proof was already used. |
| `WrongBindValue(uint256 required, uint256 provided)` | `msg.value` is less than `quoteBind`. |
| `WrongFeeValue(uint256 required, uint256 provided)` | The extra value does not match the service fee in the proof. |

## Admin functions

The owner can call `setPlatform`, `setProofVerifier`, `upgradeToAndCall` and
the ownership functions. See [What a binding proves](/docs/concepts/trust/)
for what this means for you.
