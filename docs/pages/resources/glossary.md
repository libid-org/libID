---
title: Glossary
description: Terms used in these docs.
sidebar:
  order: 1
---

- **Binding**: the record that an identity, and its handle, are bound to a
  holder.
- **Disclosure**: putting a handle's text on chain, with `bind`, `publish`,
  `reveal` or `HandleEscrow.depositToHandle`. Each emits `HandleRevealed`.
  It cannot be undone.
- **Folding**: lowercasing `A` to `Z` in a handle before it is hashed.
  Nothing else changes, so `@octocat` and `octocat` are different handles.
- **Handle**: the name an identity uses on its platform: a GitHub login, an X
  username, or a Google email address. It can change.
- **`handleNode`, `idNode`**: the `bytes32` keys a handle and an id are stored
  under. See [Platforms and nodes](/docs/concepts/platforms-and-nodes/).
- **Holder**: the address an identity is bound to.
- **Id**: the id a platform gives an account. It never changes. For Google,
  it is the `sub` claim of the sign-in token. libID stores only its node.
- **Identity**: a platform account proved to a holder. It has an id and a
  handle.
- **Notary**: the service that signs records of a user's sessions with GitHub
  and X.
- **`observedAt`**: when the platform confirmed a binding, in Unix seconds.
  See [Freshness](/docs/concepts/freshness/).
- **Owner**: the admin of a contract, who can upgrade it or change its
  settings. Never the holder of an identity.
- **Platform**: GitHub, X or Google. Its key is `github`, `x` or `google`.
- **`platformId`**: `keccak256` of the platform key.
- **Primary handle**: the one handle a holder chose to show as its name, on
  any platform. See [Primary handle](/docs/concepts/primary-handle/).
- **Proof**: the evidence a holder sends to `bind`: platform data plus a
  zero-knowledge proof.
- **Round**: in `HandleEscrow`, the deposits of one token to one handle made
  between two claims of that token.
