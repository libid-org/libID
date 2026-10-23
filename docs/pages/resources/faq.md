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
the old identity's id node can notice with `resolveHandleAndId`. See
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-holder).

## Does libID stop one person from having many accounts?

No. A binding proves that an address holds an account, not that a person has
only one.

## Is my email public if I bind Google?

Not unless it is disclosed. The handle of a Google account is its email
address. A binding puts only its node, a SHA-256 hash, on chain. The address
is on chain if you disclose it, with `bind`, `publish` or `reveal`, or if
someone pays it by its text, with `HandleEscrow.depositToHandle`. Once on
chain, it stays in the chain's history for good, even after `unpublish`.

A node does not keep the address secret. Anyone who guesses it can hash it
and find your binding. See
[What becomes public](/docs/concepts/trust/#what-becomes-public).
