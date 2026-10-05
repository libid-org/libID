---
title: Glossary
description: Terms used in these docs.
sidebar:
  order: 1
---

- **Binding**: the record that an identity, and its handle, are bound to a
  holder.
- **Handle**: the name an identity uses on its platform: a GitHub login, an X
  username, or a Google email address. It can change.
- **`handleNode`, `idNode`**: the `bytes32` keys a handle and an id are stored
  under. See [Platforms and nodes](/docs/concepts/platforms-and-nodes/).
- **Holder**: the address an identity is bound to.
- **Id**: the id a platform gives an account. It never changes. For Google,
  libID stores `SHA256("libid.google-user-id" || sub)`, as `0x` and 64
  lowercase hex digits.
- **Identity**: a platform account proved to a holder. It has an id and a
  handle.
- **Normalization**: the rules that turn the different ways of writing a
  handle into one form, such as lowercasing and removing a leading `@`.
- **Notary**: the service that signs records of a user's sessions with GitHub
  and X.
- **`observedAt`**: when the platform confirmed a binding, in Unix seconds.
  See [Freshness](/docs/concepts/freshness/).
- **Owner**: the admin of a contract, who can upgrade it or change its
  settings. Never the holder of an identity.
- **Platform**: GitHub, X or Google. Its key is `github`, `x` or `google`.
- **`platformId`**: `keccak256` of the platform key.
- **Proof**: the evidence a holder sends to `bind`: platform data plus a
  zero-knowledge proof.
- **Published handle**: the one handle a holder chose to show on a platform.
  See [Published handles](/docs/concepts/published-handles/).
- **Round**: in `HandleEscrow`, the deposits made between two claims.
