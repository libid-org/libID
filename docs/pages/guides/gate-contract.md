---
title: Gate a contract
description: Let only holders of a verified identity call a function.
sidebar:
  order: 3
---

Your contract can ask `IdentityRegistry` who holds an identity, and allow a
call only from that holder. This guide builds two small contracts: a guestbook
that only GitHub users can sign, and an airdrop that pays each GitHub identity
once.

## The interface

Declare the functions you need from `IdentityRegistry`:

```solidity
interface IIdentityRegistry {
    function handleNodeOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
    function handleBinding(bytes32 handleNode) external view returns (address holder, uint64 observedAt);
    function resolveId(bytes32 platformId, string calldata id) external view returns (address);
}
```

The contracts below take the `IdentityRegistry` address in their constructor, so
the same code works on the local chain and on a public network.

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

`handleNodeOf` normalizes the handle and returns the key it is stored under.
`handleBinding` returns the holder and the time the platform confirmed it. `handleNodeOf`
reverts with `UnusableHandle` if the text can never be a GitHub handle.

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
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant AMOUNT = 0.01 ether;

    mapping(bytes32 => bool) public claimed;

    error NotYourIdentity();
    error AlreadyClaimed();
    error PayoutFailed();

    constructor(IIdentityRegistry registry_) {
        registry = registry_;
    }

    function claim(string calldata id) external {
        if (registry.resolveId(GITHUB, id) != msg.sender) revert NotYourIdentity();

        bytes32 identity = keccak256(bytes(id));
        if (claimed[identity]) revert AlreadyClaimed();
        claimed[identity] = true;

        (bool ok, ) = msg.sender.call{value: AMOUNT}("");
        if (!ok) revert PayoutFailed();
    }

    receive() external payable {}
}
```

`claim` marks the identity as paid before it sends the ETH, so a holder
that calls back into `claim` finds it already claimed. It sends with `call`,
not `transfer`, so a smart wallet such as a Safe can receive the payment.

`resolveId` returns the holder of the identity with that id, or the zero
address. Your app can find a user's id with
[`identitiesOf`](/docs/guides/lookup-wallet/).

## Try it

Put the interface and both contracts in `src/Gate.sol` of a
[Foundry](https://getfoundry.sh) project, with
`pragma solidity ^0.8.24;` at the top. Set `RPC_URL`,
`IDENTITY_REGISTRY` and `PRIVATE_KEY` as
[Test on a local chain](/docs/guides/local-chain/) shows, then deploy the
guestbook:

```sh
GUESTBOOK=$(forge create src/Gate.sol:Guestbook --broadcast \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
  --constructor-args $IDENTITY_REGISTRY | awk '/Deployed to/ {print $3}')
```

On the [local chain](/docs/guides/local-chain/#the-guides-test-data),
`PRIVATE_KEY`'s address holds the GitHub handle `alice-dev`, so it can sign.
Elsewhere, use a handle your address has bound:

```sh
cast send $GUESTBOOK 'sign(string,string)' alice-dev 'hello' \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

Signing as `octocat` from the same address reverts with `NotYourHandle`,
because another address holds `octocat`.
