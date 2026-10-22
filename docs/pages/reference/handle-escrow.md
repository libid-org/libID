---
title: HandleEscrow
description: Functions, events and errors of the contract that pays handles.
sidebar:
  order: 2
---

`HandleEscrow` sends ETH or ERC-20 tokens to a handle. It pays the handle's
holder at once, or holds the funds until someone proves the handle and
claims them. It reads holders from `IdentityRegistry`. See
[Send funds to a handle](/docs/guides/pay-a-handle/) for a walkthrough.

The full source is
[HandleEscrow.sol](https://github.com/libid-org/libID-contracts/blob/main/solidity/contracts/escrow/HandleEscrow.sol).

## Tokens

`NATIVE()` returns `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, the address
the escrow uses for ETH ([EIP-7528](https://eips.ethereum.org/EIPS/eip-7528)).
Any other token address is treated as an ERC-20.

Each token is held as one pool. These tokens do not work:

- Tokens that charge a fee to the sender on `transfer`. Deposits work, but
  every claim and refund reverts `OverDebited`.
- Tokens whose balances change on their own (rebasing tokens).
- Tokens that can block the escrow's address. A block freezes the funds.

## Functions

### deposit

```solidity
function deposit(bytes32 platformId, bytes32 handleNode, address token, uint256 amount, address refundTo)
    payable
```

Pays `amount` of `token` to a handle. `handleNode` is the handle's node
(`IdentityRegistry.handleNodeOf`, or `handleNode` in the TypeScript package).
The handle itself is not sent.

- If someone holds the handle, they are paid now and `Forwarded` is emitted.
- Otherwise the funds are held and `Deposited` is emitted. Until the holder
  claims, `refundTo` can take them back by calling `refund` itself.

For ETH, `msg.value` must equal `amount`. For a token, approve the escrow
first and send no ETH.

The escrow cannot check the node. A wrong node holds the funds where nobody
can claim them; only `refundTo` can get them back.

### depositToHandle

```solidity
function depositToHandle(bytes32 platformId, string handle, address token, uint256 amount, address refundTo)
    payable
```

Same as `deposit`, but takes the handle as text. The escrow computes the node
with `IdentityRegistry.handleNodeOf` and emits `HandleRevealed` with the
folded handle. The handle is public in the calldata and in the log.

### claim

```solidity
function claim(bytes32 handleNode, address[] tokens, address recipient)
```

Sends everything held for the handle, in each of `tokens`, to `recipient`.
The caller must be the handle's holder (`IdentityRegistry.handleBinding`). Tokens with
nothing held are skipped. Reverts `NothingHeld` if nothing was paid.

After a claim, the deposits it took, in the tokens it claimed, can no
longer be refunded.

### refund

```solidity
function refund(bytes32 handleNode, address token, address recipient)
```

Sends `recipient` every deposit for the handle, in one token, that named the
caller as `refundTo`. The depositor does not count: only the `refundTo`
address can call it. Only deposits made since the last claim of that token
can be refunded.
Works whether or not the handle has a holder.

### escrowed

```solidity
function escrowed(bytes32 handleNode, address token) view returns (uint256)
```

How much is held for the handle in one token right now.

### refundable

```solidity
function refundable(bytes32 handleNode, address token, address refundTo) view returns (uint256)
```

How much `refund` would pay `refundTo` right now.

### registry

```solidity
function registry() view returns (address)
```

The `IdentityRegistry` contract this escrow reads. It is set when the escrow
is deployed. No function changes it, but an upgrade can; see
[Admin functions](#admin-functions).

## Events

```solidity
event Deposited(
    bytes32 indexed handleNode, address indexed token, address indexed refundTo,
    address depositor, uint256 round, uint256 amount
);
event Forwarded(
    bytes32 indexed handleNode, address indexed token, address indexed depositor,
    address holder, uint256 amount, uint256 received
);
event HandleRevealed(bytes32 indexed platformId, bytes32 indexed handleNode, string handle);
event Claimed(
    bytes32 indexed handleNode, address indexed token, address indexed claimer,
    address recipient, uint256 round, uint256 released, uint256 received
);
event Refunded(
    bytes32 indexed handleNode, address indexed token, address indexed refundTo,
    address recipient, uint256 round, uint256 released, uint256 received
);
```

`round` groups deposits between claims, separately for each handle and
token. A claim ends the round only for the tokens it paid out; the other
tokens' rounds stay open. A `Refunded` belongs to the deposits of its
round.

`amount` in `Deposited` is what arrived. `released` is what left the escrow's
books, and `received` is what the recipient gained. They differ only for
tokens that take a fee.

`HandleRevealed` follows the `Deposited` or `Forwarded` of a
`depositToHandle`. It is the same event `IdentityRegistry` emits for handle
text, and the only escrow event with the platform or the handle. For a node paid with `deposit`, find the platform in the registry's
`IdentityBound` once someone binds the handle.

## Errors

| Error | When |
| --- | --- |
| `ZeroAmount()` | `amount` is zero, or nothing arrived. |
| `ValueMismatch(uint256 expected, uint256 provided)` | `msg.value` does not match. |
| `BadRefundTo(address refundTo)` | `refundTo` is zero or the escrow. |
| `BadToken(address token)` | `token` is not `NATIVE` and has no code. |
| `PayingYourself(address holder)` | You hold the handle you are paying. |
| `PlatformAcceptsNoBindings(bytes32 platformId)` | Nobody holds the handle and the platform accepts no new proofs, so the funds could never be claimed. |
| `UnknownPlatform(bytes32 platformId)` | Raised by `IdentityRegistry`: the platform is not GitHub, X or Google. `deposit` raises it only when nobody holds the node; `depositToHandle` always does. |
| `NotTheHolder(address holder, address caller)` | `claim` was called by someone other than the holder. |
| `NothingHeld(bytes32 handleNode)` | `claim` found nothing in any listed token. |
| `NothingToRefund(bytes32 handleNode, address token, address refundTo)` | No deposit in this round named the caller as `refundTo`. |
| `BadRecipient(address recipient)` | `recipient` is zero or the escrow. |
| `OverDebited(address token, uint256 booked, uint256 debited)` | The token took more than the escrow booked. |
| `NativeTransferFailed(address recipient, uint256 amount)` | The recipient rejected ETH. |

## Admin functions

The owner of the contract can upgrade it with `upgradeToAndCall`. The new
code can read another registry or move the funds the escrow holds. So you
trust the owner with every held deposit. `renounceOwnership` always reverts.

See [Security](/docs/resources/security/#admin-keys) for who the owner is.
