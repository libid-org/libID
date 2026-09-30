---
title: What a binding proves
description: What your app can rely on when IdentityNames says a wallet owns an account, and whom you trust for it.
sidebar:
  order: 5
---

When `IdentityNames` says a wallet owns an account, it means this:

> At time `observedAt`, someone signed in to this platform account and
> approved binding it to this wallet. The platform's own response named the
> account id and the handle.

The wallet had to send the transaction itself. A proof made for one wallet
cannot bind another.

## What it does not prove

- That the same person still controls the account today. See
  [Freshness](/docs/concepts/freshness/).
- That the handle still belongs to the account on the platform today.
- Who the person is. A binding links a wallet to an account, not to a legal
  identity.
- That one person has one account. Anyone can create many accounts on these
  platforms and bind each of them.

## What becomes public

Binding an account publishes, on chain and forever, the wallet, the platform,
the account id and the handle. For Google, the handle is the email address.
The Google account id is a digest, so Google's internal id stays private.

## Whom you trust

A binding is only as good as the parties that produce and check it:

- **The platform.** GitHub, X and Google decide who can sign in to an account
  and what their servers say about it.
- **The notary**, for GitHub and X. The browser records the user's session
  with the platform using [TLSNotary](https://tlsnotary.org), and the notary
  signs that record. A notary that signs false records can bind any account.
  Google needs no notary, because Google signs its sign-in tokens itself.
- **The verifier contracts** that check each proof, and the proving circuits
  they check against.
- **The owners of the contracts.** The owners of `IdentityNames`, the proof
  verifier, the notary service, the platform verifiers and `GoogleJwtRoots`
  can change which proofs are accepted, or upgrade the contracts. Whoever
  controls these keys can bind any account to any wallet.
- **The chain** your app reads from.

`HandleEscrow` pays whoever `IdentityNames` says holds a handle. So every
party above can also redirect funds waiting in the escrow.

The [trust model](/docs/advanced/trust-model/) page goes into more detail.

## When things go wrong

**A platform account is taken over.** The attacker can prove the account from
their own wallet. The newer proof wins, so the account and its handle now
point to the attacker. Funds sent to the handle, and funds waiting in the
escrow for it, go to the attacker. When the owner gets the account back, they
can prove it again from their wallet, and the binding moves back. What was
paid in the meantime is not returned.

**A handle is given to someone else.** Once the new owner proves it, the
handle points to them. See
[Accounts and handles](/docs/concepts/accounts-and-handles/) and
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-owner).

**A key or verifier is compromised.** The owners can replace a verifier or
remove a notary key. That stops new bad bindings. It does not undo bindings
already written.

## Current status

The contracts have not been audited. They are upgradeable. On the Eden
testnet one key owns all of them. See [Security](/docs/resources/security/).
