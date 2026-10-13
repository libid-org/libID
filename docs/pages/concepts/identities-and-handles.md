---
title: Identities and handles
description: Why ids are stable and handles are not, and what that means for your app.
sidebar:
  order: 2
---

An identity is a platform account proved to a holder: the address it is bound
to. Each identity has an id, which never changes, and a handle, which can.
Your app should know which of the two it relies on.

```mermaid
flowchart TB
  subgraph s1["1. Alice proves alice"]
    direction LR
    a1["Identity, id 1001"] -- handle --> h1["alice"]
    a1 -- holder --> w1["Address A"]
  end
  subgraph s2["2. Alice renames to alice2 and proves it"]
    direction LR
    a2["Identity, id 1001"] -- handle --> h2["alice2"]
    a2 -- holder --> w2["Address A"]
    x2["alice: held by nobody"]
  end
  subgraph s3["3. GitHub gives alice to Bob, and Bob proves it"]
    direction LR
    b3["Identity, id 2002"] -- handle --> h3["alice"]
    b3 -- holder --> w3["Address B"]
  end
  s1 --> s2 --> s3
```

The id stays the same through every step; the handle moves.
`resolveHandle('alice')` returns address A, then nobody, then address B.

## Ids stay

An id is fixed for the life of the platform account. If you need to remember
a person, remember their id: store it, count it, or key a mapping by it. The
[airdrop example](/docs/guides/gate-contract/#an-airdrop-once-per-identity)
does this.

## Handles move

A handle is the name a platform lets an account use for now. It can change in
three ways:

- The identity renames itself. When it proves its new handle, the old one
  stops resolving, and `HandleRetired` is emitted.
- The platform gives an old handle to a new account. When that identity proves
  it, the handle points to the new holder.
- The identity moves to another holder by proving itself from that address.
  The handle follows the identity.

Until someone proves a handle again, libID still points it at the last
identity that did. libID only knows what someone has proved.

## What to use when

| You want to | Use |
| --- | --- |
| Let a user type a handle to pay | `resolveHandle` |
| Show who an address is | `publishedHandleOf`, or `identitiesOf` for every identity |
| Remember a person across renames | the id: `resolveId` |
| Check a handle still leads to the person you paid before | `resolveHandleAndId` with the saved id |
| Pay someone who has not joined yet | the handle, through `HandleEscrow` |

## One holder, many identities

A holder can prove any number of identities, on the same platform or on
different ones. Each identity has one holder at a time. `identitiesOf` lists
them.
