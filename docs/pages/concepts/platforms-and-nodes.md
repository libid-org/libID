---
title: Platforms and nodes
description: How a platform, an account and a handle become the keys the contracts use.
sidebar:
  order: 1
---

libID works with three platforms: GitHub, X and Google. Each has a name, and
the contracts identify it by the hash of that name:

```js
platformId('github') // keccak256("github")
```

The names are `github`, `x` and `google`.

## Accounts and handles

On each platform, an account has two things:

| | GitHub | X | Google |
| --- | --- | --- | --- |
| Account id | the numeric user id | the numeric user id | a SHA-256 digest of the account's `sub` |
| Handle | the login, like `octocat` | the username, like `jack` | the email address |

The account id never changes. The handle can: users rename themselves, and
platforms give old names to new users.

## Nodes

The contracts do not store strings as keys. They hash each account id and
each handle into a `bytes32` key called a node:

```solidity
idNode     = keccak256(abi.encode(keccak256("libid.identity.id-node.v1"),     platformId, keccak256(userId)))
handleNode = keccak256(abi.encode(keccak256("libid.identity.handle-node.v1"), platformId, keccak256(handle)))
```

The platform is part of the node, so `alice` on X and `alice` on GitHub are
different nodes.

You rarely compute nodes yourself. `IdentityNames.nodeOf(platformId, handle)`
returns a handle's node, and `handleNode` in the TypeScript package computes it
locally.

## Normalization

Before a handle is hashed, it is normalized, so that the different ways of
writing one handle reach the same node:

- Letters are lowercased.
- On GitHub and X, one leading `@` is removed.
- X allows `_` but not `-`. GitHub allows `-` but not `_`. A `-` can never be
  first, last, or doubled.
- Handles longer than 15 characters on X, 39 on GitHub, or 62 for Google are
  refused.
- Only ASCII is allowed.

So `@Octocat`, `octocat` and `OCTOCAT` are the same GitHub handle. Text that
breaks these rules is not a handle: `resolveHandle` returns the zero address
for it, and `nodeOf` reverts with `UnusableHandle`.

The exact rules are in a shared table of test vectors; see
[handle normalization](/specs/platform-ceremonies/#21a-handle-normalization)
in the spec. `IdentityNames.rulesOf(platformId)` returns the rules a network
uses.
