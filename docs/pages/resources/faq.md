---
title: FAQ
description: Common questions.
sidebar:
  order: 2
---

## Where can I test today?

On a [local chain](/docs/guides/local-chain/). The Eden testnet runs an older
version of `IdentityNames`, and `HandleEscrow` is not deployed on a public
network yet. See [Networks](/docs/networks/eden/).

## How does a user create a binding?

With the libID sign-in flow, which signs them in to the platform, builds a
proof, and sends `bind` from their wallet. See
[How binding works](/docs/advanced/how-binding-works/).

## What does it cost?

Reading is free. A binding costs gas plus `quoteBind`, which is zero for
Google and two notary fees for GitHub and X. An app may add its own fee. The
escrow costs gas only.

## What happens if someone's account is hacked?

The attacker can bind the account to their own wallet, and payments to the
handle go to them until the owner proves the account again. See
[What a binding proves](/docs/concepts/trust/#when-things-go-wrong).

## What if a handle is given to someone else?

Once the new owner proves it, it points to their wallet. Apps that saved the
old owner's account id can notice with `resolvePair`. See
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-owner).

## Does libID stop one person from having many accounts?

No. A binding proves that a wallet owns an account, not that a person owns
only one.

## Is my email public if I bind Google?

Yes. The handle of a Google account is its email address, and a binding
publishes it on chain.
