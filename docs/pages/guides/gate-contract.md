---
title: Gate a contract
description: Let only wallets with a verified account call a function.
sidebar:
  order: 3
---

Your contract can ask `IdentityNames` who owns an account, and allow a call
only from that owner. This guide builds two small contracts: a guestbook that
only GitHub users can sign, and an airdrop that pays each GitHub account once.

## The interface

Declare the functions you need from `IdentityNames`:

```solidity
interface IIdentityNames {
    function nodeOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
    function byHandle(bytes32 handleNode) external view returns (address owner, uint64 observedAt);
    function resolveId(bytes32 platformId, string calldata userId) external view returns (address);
}
```

`IdentityNames` has the same address on every network, so you can make it a
constant.

## A guestbook for GitHub users

The caller says which handle is theirs. The contract checks that the handle
belongs to the caller, and that the proof is not too old:

```solidity
contract Guestbook {
    IIdentityNames constant NAMES = IIdentityNames(0xe78B53A183DD51763dF44beb2500dDaB9Bb0329e);
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant MAX_AGE = 90 days;

    error NotYourHandle();
    error ProofTooOld();

    event Signed(string handle, string message);

    function sign(string calldata handle, string calldata message) external {
        bytes32 node = NAMES.nodeOf(GITHUB, handle);
        (address owner, uint64 observedAt) = NAMES.byHandle(node);

        if (owner != msg.sender) revert NotYourHandle();
        if (block.timestamp - observedAt > MAX_AGE) revert ProofTooOld();

        emit Signed(handle, message);
    }
}
```

`nodeOf` normalizes the handle and returns the key it is stored under.
`byHandle` returns the owner and the time the platform confirmed it. `nodeOf`
reverts with `UnusableHandle` if the text can never be a GitHub handle.

Handles can be renamed and reused on GitHub. `MAX_AGE` limits how long ago
the owner last proved it. Pick a value that fits what the call is worth.

## An airdrop, once per account

A wallet can own many GitHub accounts, and an account can move to another
wallet. To pay each account once, record the account, not the wallet.
The account id never changes, so use it instead of the handle:

```solidity
contract Airdrop {
    IIdentityNames constant NAMES = IIdentityNames(0xe78B53A183DD51763dF44beb2500dDaB9Bb0329e);
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant AMOUNT = 0.01 ether;

    mapping(bytes32 => bool) public claimed;

    error NotYourAccount();
    error AlreadyClaimed();

    function claim(string calldata userId) external {
        if (NAMES.resolveId(GITHUB, userId) != msg.sender) revert NotYourAccount();

        bytes32 account = keccak256(bytes(userId));
        if (claimed[account]) revert AlreadyClaimed();
        claimed[account] = true;

        payable(msg.sender).transfer(AMOUNT);
    }

    receive() external payable {}
}
```

`resolveId` returns the wallet that owns the account id, or the zero address.
Your app can find a user's account id with
[`accountsOf`](/docs/guides/lookup-wallet/).

## Try it

Deploy either contract with [Foundry](https://getfoundry.sh), then call it
from a wallet that has a GitHub binding:

```sh
cast send $GUESTBOOK 'sign(string,string)' octocat 'hello' \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL
```

A call from any other wallet reverts with `NotYourHandle`.
