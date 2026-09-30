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
they point wherever `IdentityNames` says the handle points.

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

Names are always lowercase.

On X, each `_` becomes `-`, because X handles cannot contain `-`.

For Gmail, the part before `@` becomes the name, and `gmail.com` is left out.
A Google Workspace address keeps its domain after an `_at` label:
`alice@company.com` becomes `alice._at.company.com.google.handles.link`. An
address with `_` or `+` in it has no ENS name.

## Which chain

A handle can be proved on several chains, and each chain has its own
`IdentityNames`. The name gives the address on the chain the sender asks
about, and no address on a chain where the handle has no binding. Wallets
that follow [ENSIP-11](https://docs.ens.domains/ensip/11) ask for the chain
they are about to send on, so they never send to a chain where the handle
has no owner.

Add a chain label to make a name work on one chain only:

```
octocat.github.base.handles.link
```

This name gives an address only when the sender asks for Base.

## What resolves

Only addresses. Text records and avatars come back empty, and a wallet's
reverse name is not set. To show a name for a wallet, use
[`primaryName`](/docs/guides/lookup-wallet/).
