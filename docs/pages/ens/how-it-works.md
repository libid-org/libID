---
title: How it works
description: The resolver, the gateway, and what you trust when you resolve a handles.link name.
sidebar:
  order: 3
---

`handles.link` is a DNS name imported into ENS on Ethereum mainnet. Its
resolver is `HandleResolver`, one contract that answers for every name under
it. No name is stored anywhere.

## Resolving a name

```mermaid
sequenceDiagram
  participant W as Wallet on Ethereum
  participant E as ENS
  participant R as Resolver
  participant G as Gateway
  W->>E: resolver for the name?
  E-->>W: Resolver
  W->>R: resolve, for Ethereum
  R-->>W: ask the gateway
  W->>G: same question
  G->>G: look up its copy of IdentityRegistry on Ethereum
  G-->>W: signed answer
  W->>R: resolveWithProof
  R-->>W: address on Ethereum, or none
```

The wallet names the chain it will send on, here Ethereum mainnet, and gets
the holder on that chain only. Today the gateway serves Ethereum mainnet
only; see [Status](/docs/ens/names/#status). `Resolver` is `HandleResolver`,
set on `handles.link` in ENS on Ethereum. The signed answer is valid for 5
minutes.

1. The client asks ENS for the resolver of `octocat.github.handles.link`.
   There is none for the full name, so ENS returns the one set on
   `handles.link`.
2. The client calls `resolve` on `HandleResolver`. It replies with an
   `OffchainLookup` error that lists the gateway URLs.
3. The client asks the gateway. The gateway looks the handle up in its own
   copy of `IdentityRegistry` on the chain the client asked about, and signs
   the answer.
4. The client passes the signed answer back to `HandleResolver`, which checks
   the signature and returns the address.

Steps 2 and 4 are read-only calls. Nothing is sent and no gas is spent.

## The gateway

The gateway is part of the libID [indexer](https://github.com/libid-org/usernames-indexer).
The indexer follows `IdentityBound` and the other registry events and keeps
a copy of every binding on every chain the gateway serves. The gateway
answers from that copy, not from the chain. Its URL is
`https://names.handles.link/ens/{sender}/{data}.json`.

The copy runs a few blocks behind the chain. If it falls too far behind, the
gateway does not answer for that chain, and the client gets no address.

A signed answer is good for 5 minutes, and `HandleResolver` refuses any
answer that claims to be good for more than an hour. An answer stays valid
until it expires, even if the handle changed holder in between. So for a few
minutes after a handle moves, a name can still give the old holder.

## What you trust

When you resolve through ENS, you trust:

- the indexer, to copy the registry correctly and keep up with it,
- the gateway's signing key,
- the owner of `HandleResolver`, who chooses which keys and URLs it accepts,
- the owner of `handles.link` in ENS, who can point the name at another
  resolver with `setResolver`, and
- whoever controls the DNS zone of `handles.link`. It is a DNS name imported
  into ENS, so control of the zone can claim the ENS name again.

The libID team runs all of them. On Ethereum mainnet the key that owns the
libID contracts also owns `handles.link` and `HandleResolver`; see
[Security](/docs/resources/security/#admin-keys).

When you call `IdentityRegistry` yourself, you trust none of these: your code
reads the chain directly. Use `IdentityRegistry` when the amount at stake is
large.
