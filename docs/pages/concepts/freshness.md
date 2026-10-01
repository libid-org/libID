---
title: Freshness
description: What observedAt means, and how old is too old.
sidebar:
  order: 3
---

Every binding stores `observedAt`: a time, in Unix seconds, that tells you
when the platform confirmed who holds the identity. `handleBinding` and `idBinding` return it.

## Where the time comes from

The time is not chosen by the user or by your app. It comes from signed
evidence, moved back by a fixed allowance for each platform:

| Platform | `observedAt` is | A proof made just now looks |
| --- | --- | --- |
| GitHub, X | the time the notary signed the user's session, minus 5 minutes | 5 minutes old |
| Google | the expiry in Google's sign-in token, minus 2 hours | about an hour old |

The allowance puts every platform on one scale and keeps `observedAt` from
ever being ahead of the block. It also means a proof is never younger than
its allowance: a limit shorter than that rejects every holder.

A GitHub or X proof must reach the chain within an hour of that time, and the
time cannot be more than five minutes ahead of the block. A Google proof must
reach the chain before its token expires. Each platform's ceremony version
fixes these limits; see [Protocol parameters](/specs/#protocol-parameters).

## Newer wins

A proof is accepted only if its `observedAt` is later than the one already
stored for the same identity and for the same handle. An old proof cannot undo
a newer one, and the same proof cannot be used twice.

## What it tells you

`observedAt` says when the platform last confirmed the binding. It does not
say that the same person still has the account, or still uses that handle,
today.

Nothing refreshes a binding automatically. It changes only when someone
proves the identity or the handle again. A binding from last year is still
there, unchanged, until then.

## How old is too old

libID does not decide this for you. Pick a limit that fits what is at stake:

- To show a handle next to an address, any age is usually fine.
- To send a payment to a handle, show the age to the sender, and warn when it
  is old.
- To gate something valuable in a contract, require
  `observedAt + maxAge >= block.timestamp`, with `maxAge` well above the
  allowance: more than an hour if you accept Google. See
  [Gate a contract](/docs/guides/gate-contract/).
