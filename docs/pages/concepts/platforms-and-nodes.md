---
title: Platforms and nodes
description: How a platform, an id and a handle become the keys the contracts use.
sidebar:
  order: 1
---

libID works with three platforms: GitHub, X and Google. Each has a key, and
the contracts identify it by the hash of that key:

```js
platformId('github') // keccak256("github")
```

The keys are `github`, `x` and `google`.

## Ids and handles

An identity, a platform account proved to a holder, has two things:

| | GitHub | X | Google |
| --- | --- | --- | --- |
| Id | the numeric user id | the numeric user id | the `sub` claim of its sign-in token |
| Handle | the login, like `octocat` | the username, like `jack` | the email address |

The id never changes. The handle can: users rename themselves, and platforms
give old handles to new users.

## Nodes

The contracts do not store ids or handles as keys. They hash each id and
each handle into a `bytes32` key called a node:

```
node = SHA256(tag || value)
```

`||` joins the two byte strings. The value is the id as the platform sent it,
or the handle with `A` to `Z` lowercased. The tag names the platform and
the kind of value:

| Platform | Id tag | Handle tag |
| --- | --- | --- |
| GitHub | `libid.github.user-id` | `libid.github.handle` |
| X | `libid.x.user-id` | `libid.x.handle` |
| Google | `libid.google.user-id` | `libid.google.handle` |

The platform is part of the tag, so `alice` on X and `alice` on GitHub are
different nodes. From a shell:

```sh
printf '%s%s' libid.github.handle octocat | sha256sum | sed 's/^/0x/; s/ .*//'
```

It prints
`0x381fb9d7d3b01214e58b94202ea10f78e169adef68bcc20d40c130deca6dfe74`.

The proving circuit computes both nodes from what the platform sent. The
proof carries the nodes, and the id and handle stay off chain. A handle
reaches the chain only if its holder discloses it; see
[Primary handle](/docs/concepts/primary-handle/).

A node hides a value only from someone who cannot guess it. The tags are
public, so anyone can hash a guessed handle or id and look it up. See
[What becomes public](/docs/concepts/trust/#what-becomes-public).

You rarely compute nodes yourself. The TypeScript package does it locally:

```ts
import { handleNode, idNode } from '@libid/contracts/platforms';

handleNode('github', 'OctoCat'); // 0x381fb9d7…6dfe74
idNode('github', '583231');      // 0x475902b2…181847
```

Both take the platform key, not `platformId`.
`IdentityRegistry.handleNodeOf(platformId, handle)` returns the same handle
node, but sends the handle to your RPC provider.

## Folding

Before a handle is hashed, `A` to `Z` are lowercased. Nothing else changes:
no spaces are trimmed and no `@` is removed. So `Octocat` and `octocat` are
the same GitHub handle, but `@octocat` is a different node, which no GitHub
account can prove. `resolveHandle` returns the zero address for it.

The circuit only proves a handle exactly as the platform sent it. It refuses
an empty handle, a byte outside printable ASCII, `"` and `\`, and handles
longer than 39 bytes on GitHub and X or 62 for Google. The contracts do not
check these rules again: text the circuit refuses has no binding, so it
resolves to nobody.

`handleNode` in the TypeScript package applies the same checks and throws
`HandleError` for text the circuit refuses. `foldedHandleNode` only folds, as
the contracts do.

The exact rules are in
[the token check and folding](/specs/platform-ceremonies/#21a-the-token-check-and-folding)
in the spec.
