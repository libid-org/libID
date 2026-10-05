---
title: FAQ
description: Common questions.
sidebar:
  order: 2
---

## Where can I test today?

On [Sepolia](/docs/networks/sepolia/) or the
[Eden testnet](/docs/networks/eden/), which run the current contracts, or on
anvil with the full stack; see
[Test on a local chain](/docs/guides/local-chain/). The local-chain project
with known test data is not published yet.

## How does a user create a binding?

With the libID sign-in flow, which signs them in to the platform, builds a
proof, and sends `bind` from their wallet. See
[How binding works](/docs/advanced/how-binding-works/).

## What does it cost?

Reading is free. A binding costs gas plus `quoteBind`, which is zero for
Google and two notary fees for GitHub and X. An app may add its own fee. The
escrow costs gas only.

## What happens if someone's account is hacked?

The attacker can bind the account to their own address, and payments to the
handle go to them until the real owner proves the account again. See
[What a binding proves](/docs/concepts/trust/#when-things-go-wrong).

## What if a handle is given to someone else?

Once the new holder proves it, it points to their address. Apps that saved
the old identity's id can notice with `resolveHandleAndId`. See
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-holder).

## Does libID stop one person from having many accounts?

No. A binding proves that an address holds an account, not that a person has
only one.

## Is my email public if I bind Google?

Yes. The handle of a Google account is its email address, and a binding
publishes it on chain.
