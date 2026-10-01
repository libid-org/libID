---
title: Freshness
description: What observedAt means, and how old is too old.
sidebar:
  order: 3
---

Every binding stores `observedAt`: the time, in Unix seconds, at which the
platform confirmed who owns the account. `byHandle` and `byId` return it.

## Where the time comes from

The time is not chosen by the user or by your app. It comes from signed
evidence:

| Platform | `observedAt` is |
| --- | --- |
| GitHub, X | when the notary signed the record of the user's session with the platform |
| Google | the expiry time in Google's signed sign-in token, about an hour after sign-in |

So `observedAt` can be ahead of the current time: up to five minutes for
GitHub and X, and up to an hour for Google. Code that computes an age must
not assume it is in the past.

A GitHub or X proof must reach the chain within an hour of that time, and the
time cannot be more than five minutes ahead of the block. A Google proof must
reach the chain before its token expires. Each platform's ceremony version
fixes these limits; see [Protocol parameters](/specs/#protocol-parameters).

## Newer wins

A proof is accepted only if its `observedAt` is later than the one already
stored for the same account and for the same handle. An old proof cannot undo
a newer one, and the same proof cannot be used twice.

## What it tells you

`observedAt` says when the platform last confirmed the binding. It does not
say that the owner still has the account, or still uses that handle, today.

Nothing refreshes a binding automatically. It changes only when someone
proves the account or the handle again. A binding from last year is still
there, unchanged, until then.

## How old is too old

libID does not decide this for you. Pick a limit that fits what is at stake:

- To show a name next to a wallet, any age is usually fine.
- To send a payment to a handle, show the age to the sender, and warn when it
  is old.
- To gate something valuable in a contract, require
  `observedAt + maxAge >= block.timestamp`. Do not write
  `block.timestamp - observedAt`: it reverts when `observedAt` is ahead of
  the block. See [Gate a contract](/docs/guides/gate-contract/).
