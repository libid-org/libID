---
title: Gate a contract
description: Let only holders of a verified identity call a function.
sidebar:
  order: 3
---

Your contract can ask `IdentityRegistry` who holds an identity, and allow a
call only from that holder. This guide builds two small contracts: a guestbook
that only GitHub users can sign, and an airdrop that pays each identity once.

## The interface

Declare the functions you need from `IdentityRegistry`:

```solidity
interface IIdentityRegistry {
    function handleNodeOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
    function handleBinding(bytes32 handleNode) external view returns (address holder, uint64 observedAt);
    function resolveId(bytes32 idNode) external view returns (address);
}
```

The contracts below take the `IdentityRegistry` address in their constructor, so
the same code works on every network.

## A guestbook for GitHub users

The caller says which handle is theirs. The contract checks that the handle
belongs to the caller, and that the proof is not too old:

```solidity
contract Guestbook {
    IIdentityRegistry public immutable registry;
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant MAX_AGE = 90 days;

    error NotYourHandle();
    error ProofTooOld();

    event Signed(string handle, string message);

    constructor(IIdentityRegistry registry_) {
        registry = registry_;
    }

    function sign(string calldata handle, string calldata message) external {
        bytes32 node = registry.handleNodeOf(GITHUB, handle);
        (address holder, uint64 observedAt) = registry.handleBinding(node);

        if (holder != msg.sender) revert NotYourHandle();
        if (observedAt + MAX_AGE < block.timestamp) revert ProofTooOld();

        emit Signed(handle, message);
    }
}
```

`handleNodeOf` folds A-Z to a-z, hashes the handle, and returns the key it is
stored under. `handleBinding` returns the holder and the time the platform
confirmed it. `handleNodeOf` checks nothing else. `@testyakly` is a different
node from `testyakly`, one nobody holds, so signing as `@testyakly` reverts
with `NotYourHandle`.

Handles can be renamed and reused on GitHub. `MAX_AGE` limits how long ago
the holder last proved it. Pick a value that fits what the call is worth.

A proof bound a moment ago can already read up to 65 minutes old on GitHub
and up to 2 hours on Google, so keep `MAX_AGE` well above that. See
[Freshness](/docs/concepts/freshness/).

## An airdrop, once per identity

An address can hold many GitHub identities, and an identity can move to
another address. To pay each identity once, record the identity, not the
address. The id never changes, so use it instead of the handle:

```solidity
contract Airdrop {
    IIdentityRegistry public immutable registry;
    uint256 constant AMOUNT = 0.01 ether;

    mapping(bytes32 => bool) public claimed;

    error NotYourIdentity();
    error AlreadyClaimed();
    error PayoutFailed();

    constructor(IIdentityRegistry registry_) {
        registry = registry_;
    }

    function claim(bytes32 idNode) external {
        if (registry.resolveId(idNode) != msg.sender) revert NotYourIdentity();
        if (claimed[idNode]) revert AlreadyClaimed();
        claimed[idNode] = true;

        (bool ok, ) = msg.sender.call{value: AMOUNT}("");
        if (!ok) revert PayoutFailed();
    }

    receive() external payable {}
}
```

`claim` marks the identity as paid before it sends the ETH, so a holder
that calls back into `claim` finds it already claimed. It sends with `call`,
not `transfer`, so a smart wallet such as a Safe can receive the payment.

The registry keeps an id as its node, `SHA256(tag || id)`, where the tag
names the platform, so `claim` takes the node. `resolveId` returns its
holder, or the zero address. Your app gets the node from
`idNode('github', id)` in `@libid/contracts`, or from the holder's
`identitiesOf` or `IdentityBound` events. Any platform's identity can claim;
to pay GitHub identities only, check the platform off chain or keep a list of
the nodes you accept.

## Try it

Put the interface and both contracts in `src/Gate.sol` of a
[Foundry](https://getfoundry.sh) project, with
`pragma solidity ^0.8.24;` at the top. Set `RPC_URL` and
`IDENTITY_REGISTRY` for [Sepolia](/docs/networks/sepolia/), and
`PRIVATE_KEY` to a key with Sepolia ETH. Or run all of it on a
[fork of Sepolia](/docs/guides/local-chain/), where anvil's keys have ETH.
Then deploy the guestbook:

```sh
GUESTBOOK=$(forge create src/Gate.sol:Guestbook --broadcast \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
  --constructor-args $IDENTITY_REGISTRY | awk '/Deployed to/ {print $3}')
```

On Sepolia, `0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c` holds the GitHub
handle `testyakly`. Without its key you can still see what `sign` does for
it, because `cast call` runs the call without sending it:

```sh
cast call $GUESTBOOK 'sign(string,string)' testyakly 'hello' \
  --from 0xB2C7C8eA84932a0dADf8F6f0550cFc89A345540c --rpc-url $RPC_URL
```

It succeeds. The same call from any other address reverts with
`NotYourHandle`. Once `testyakly` was proved more than 90 days ago, it
reverts with `ProofTooOld`.

To sign for real, send it with `cast send` from an address that has bound a
GitHub handle, and pass that handle.
