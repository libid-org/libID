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

## Status

Names resolve for bindings on Ethereum mainnet. The gateway does not answer
for any other chain yet.

| Where | State |
| --- | --- |
| ENS on Ethereum mainnet | `handles.link` resolver is `HandleResolver`, `0xc09bF842BAD6350a1600277a11D954c6891974CE` |
| Gateway | `https://names.handles.link/ens/{sender}/{data}.json`, serving Ethereum mainnet only |
| ENS on Sepolia | resolver `0x84ba4D9CBAaB51180d02D9635CD9FDd0735350f3`, pointing at the same gateway, which does not serve Sepolia, so Sepolia names do not resolve |
| Names for Eden | not served; viem also cannot compute a coin type for Eden's chain id |

To see which chains the gateway serves right now:

```sh
curl https://names.handles.link/ens/status
```

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
`IdentityRegistry`. The name gives the address on the chain the sender asks
about, and no address on a chain where the handle has no binding.

This only protects the sender if the wallet asks about the chain it will send
on. Wallets that follow [ENSIP-11](https://docs.ens.domains/ensip/11) do,
MetaMask among them. A client that asks without naming a chain gets the answer
for Ethereum mainnet. If it then sends on another chain, the funds go to the
Ethereum holder's address on that chain, who may be a different person or
nobody.

Add a chain label to make a name work on one chain only:

```
octocat.github.ethereum.handles.link
```

This name gives an address only when the sender asks for Ethereum mainnet.
The gateway's status lists the labels each chain answers to.

## What resolves

Only addresses. Text records and avatars come back empty, and an address
has no reverse name. To show a handle for an address, use
[`publishedHandleOf`](/docs/guides/lookup-wallet/#show-a-handle). To list every
handle a wallet has, use [`identitiesOf`](/docs/guides/lookup-wallet/#list-every-identity).
