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

The contracts below take the `IdentityNames` address in their constructor, so
the same code works on the local chain and on a public network.

## A guestbook for GitHub users

The caller says which handle is theirs. The contract checks that the handle
belongs to the caller, and that the proof is not too old:

```solidity
contract Guestbook {
    IIdentityNames public immutable names;
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant MAX_AGE = 90 days;

    error NotYourHandle();
    error ProofTooOld();

    event Signed(string handle, string message);

    constructor(IIdentityNames names_) {
        names = names_;
    }

    function sign(string calldata handle, string calldata message) external {
        bytes32 node = names.nodeOf(GITHUB, handle);
        (address owner, uint64 observedAt) = names.byHandle(node);

        if (owner != msg.sender) revert NotYourHandle();
        if (observedAt + MAX_AGE < block.timestamp) revert ProofTooOld();

        emit Signed(handle, message);
    }
}
```

`nodeOf` normalizes the handle and returns the key it is stored under.
`byHandle` returns the owner and the time the platform confirmed it. `nodeOf`
reverts with `UnusableHandle` if the text can never be a GitHub handle.

Handles can be renamed and reused on GitHub. `MAX_AGE` limits how long ago
the owner last proved it. Pick a value that fits what the call is worth.

Write the age check as `observedAt + MAX_AGE < block.timestamp`, not
`block.timestamp - observedAt > MAX_AGE`. `observedAt` can be a little ahead
of the block time (for Google it is up to an hour ahead), and the subtraction
would then revert. See [Freshness](/docs/concepts/freshness/).

## An airdrop, once per account

A wallet can own many GitHub accounts, and an account can move to another
wallet. To pay each account once, record the account, not the wallet.
The account id never changes, so use it instead of the handle:

```solidity
contract Airdrop {
    IIdentityNames public immutable names;
    bytes32 constant GITHUB = keccak256("github");
    uint256 constant AMOUNT = 0.01 ether;

    mapping(bytes32 => bool) public claimed;

    error NotYourAccount();
    error AlreadyClaimed();

    constructor(IIdentityNames names_) {
        names = names_;
    }

    function claim(string calldata userId) external {
        if (names.resolveId(GITHUB, userId) != msg.sender) revert NotYourAccount();

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

Put the interface and both contracts in `src/Gate.sol` of a
[Foundry](https://getfoundry.sh) project, with
`pragma solidity ^0.8.24;` at the top. With the
[local chain](/docs/guides/local-chain/) running and `local.env` loaded,
deploy the guestbook:

```sh
GUESTBOOK=$(forge create src/Gate.sol:Guestbook --broadcast \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
  --constructor-args $IDENTITY_NAMES | awk '/Deployed to/ {print $3}')
```

`PRIVATE_KEY`'s wallet owns the GitHub handle `alice-dev`, so it can sign:

```sh
cast send $GUESTBOOK 'sign(string,string)' alice-dev 'hello' \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

Signing as `octocat` from the same wallet reverts with `NotYourHandle`,
because `octocat` belongs to another wallet.
