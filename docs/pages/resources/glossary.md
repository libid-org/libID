---
title: Glossary
description: Terms used in these docs.
sidebar:
  order: 1
---

- **Account id** (`userId`): the id a platform gives an account. It never
  changes. For Google, libID stores a digest of it.
- **Binding**: the record that a wallet owns a platform account and its
  handle.
- **Handle**: the name an account uses on a platform: a GitHub login, an X
  username, or a Google email address. It can change.
- **`handleNode`, `idNode`**: the `bytes32` keys a handle and an account are
  stored under. See [Platforms and nodes](/docs/concepts/platforms-and-nodes/).
- **Normalization**: the rules that turn the different ways of writing a
  handle into one form, such as lowercasing and removing a leading `@`.
- **Notary**: the service that signs records of a user's sessions with GitHub
  and X.
- **`observedAt`**: when the platform confirmed a binding, in Unix seconds.
  See [Freshness](/docs/concepts/freshness/).
- **Platform**: GitHub, X or Google.
- **`platformId`**: `keccak256("github")`, `keccak256("x")` or
  `keccak256("google")`.
- **Primary name**: the one handle a wallet chose to show on a platform. See
  [Primary names](/docs/concepts/primary-names/).
- **Proof**: the evidence a wallet sends to `bind`: platform data plus a
  zero-knowledge proof.
- **Round**: in `HandleEscrow`, the deposits made between two claims.
