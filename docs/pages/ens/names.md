---
title: ENS names
description: Every libID handle is also an ENS name under handles.link.
sidebar:
  order: 1
---

Every handle proved in libID is also an ENS name. A user can put
`octocat.github.handles.link` in their profile, and anyone can paste it into a
wallet that supports ENS to send them funds. The sender does not need to know
about libID.

Nobody registers these names. They exist as soon as the handle is proved, and
they point wherever `IdentityRegistry` says the handle points.

The rules are in the [ENS integration spec](/specs/ens-integration/). This
page covers what you need to use the names.

## Name shape

```
<handle>.<platform>.handles.link
<handle>.<platform>.<chain>.handles.link
```

The platform is `github`, `x` or `google`. Some examples:

| Account | ENS name |
| --- | --- |
| GitHub `octocat` | `octocat.github.handles.link` |
| X `@some_handle` | `some-handle.x.handles.link` |
| Gmail `alice.smith@gmail.com` | `alice.smith.google.handles.link` |

Names are always lowercase. On X, each `_` becomes `-`. For Gmail, the part
before `@` becomes the name. Some handles have no name, for example an email
address with `_` or `+` in it. The full rules, Google Workspace addresses
included, are in [Handle labels](/specs/ens-integration/#6-handle-labels).

## Which chain

A handle can be proved on several chains, and each chain has its own
`IdentityRegistry`. The name gives the address on the chain the sender asks
about, by its [ENSIP-11](https://docs.ens.domains/ensip/11) coin type, and no
address on a chain where the handle has no binding. A client that asks
without naming a chain gets the answer for the chain whose ENS it asked:
Ethereum mainnet for `handles.link`.

This only protects the sender if the wallet asks about the chain it will send
on. If it asks without naming a chain and then sends on another one, the
funds go to the mainnet holder's address on that chain, who may be a
different person or nobody.

A chain label makes a name work on one chain only:

```
octocat.github.ethereum.handles.link
```

This name gives an address only when the sender asks for Ethereum mainnet.

## Testnets

Testnet bindings have their own names under `testnet.handles.link`, resolved
through ENS on Sepolia:

```
<handle>.<platform>.testnet.handles.link
<handle>.<platform>.<chain>.testnet.handles.link
```

For example, `testyakly.github.testnet.handles.link` gives the holder of
`testyakly` on Sepolia. The chain labels are `sepolia` and `eden`.

Eden's chain id, `3735928814`, is larger than `2^31`, so viem's `toCoinType`
refuses it. Pass the coin type by hand. For Eden it is the chain id itself,
because `0x80000000 | 3735928814` is `3735928814`. See
[Resolve with ENS](/docs/ens/resolve/#testnets).

## Which chains are served

Each gateway lists the chains it answers for, and the chain labels of each:

```sh
curl https://names.handles.link/ens/status
curl https://testnet.names.handles.link/ens/status
```

A chain marked `stale` falls too far behind, and gets no answer until it
catches up.

## What resolves

Only addresses. Text records and avatars come back empty, and an address
has no reverse name. To show a handle for an address, use
[`primaryHandleOf`](/docs/guides/lookup-wallet/#show-a-handle). To list every
identity a wallet has, use [`identitiesOf`](/docs/guides/lookup-wallet/#list-every-identity).
It returns nodes, not handles.
