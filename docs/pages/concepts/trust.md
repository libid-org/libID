---
title: What a binding proves
description: What your app can rely on when IdentityRegistry says an address holds an identity, and whom you trust for it.
sidebar:
  order: 5
---

When `IdentityRegistry` says an address is the holder of an identity, it means
this:

> At time `observedAt`, someone signed in to this platform account and
> approved binding it to this address. The platform's own response named the
> id and the handle.

The holder had to send the transaction itself. A proof made for one holder
cannot bind another.

## What it does not prove

- That the same person still controls the account today. See
  [Freshness](/docs/concepts/freshness/).
- That the handle still belongs to the account on the platform today.
- Who the person is. A binding links an address to an account, not to a legal
  identity.
- That one person has one account. Anyone can create many accounts on these
  platforms and bind each of them.

## What becomes public

Binding an identity puts on chain, forever, the holder, the platform,
`observedAt`, and two nodes: hashes of the id and of the handle. The id is
never on chain. The handle is on chain only if a transaction discloses it:
a `bind` with the handle, a `publish` or a `reveal`, or a payment to the
handle by its text with `HandleEscrow.depositToHandle`. For Google, the handle is the
email address. See
[Platforms and nodes](/docs/concepts/platforms-and-nodes/#ids-and-handles).

A handle or id that was never disclosed is still not secret:

- A node is a SHA-256 of a public tag and the value, with no salt. Anyone
  who guesses a handle, an email address or an id can hash it and look it up.
- GitHub ids are sequential, so every GitHub id node is in effect public.
  X ids and Google `sub` values are longer, but not secret: every app a user
  signs in to with Google knows that user's `sub`.
- A GitHub or X binding shows the byte lengths of the id and the handle.
- Every use of a node links to every other use of it.
- The app that runs the sign-in sees the id and the handle, and builds the
  `bind` call. It decides whether the handle is disclosed.
- A disclosure cannot be taken back. `unpublish` clears only the primary
  handle. The `HandleRevealed` log and the transaction that carried the
  handle stay in the chain's history.

## Whom you trust

A binding is only as good as the parties that produce and check it:

- The platform. GitHub, X and Google decide who can sign in to an account
  and what their servers say about it.
- The notary. For GitHub and X, the browser records the user's session with
  the platform using [TLSNotary](https://tlsnotary.org), and the notary signs
  that record. Google signs its sign-in tokens itself, but the keys it signs
  with reach the chain through the notary too: anyone can call
  `GoogleJwtRoots.rotate` with a notary-signed reading of Google's key list.
  So a notary key that signs false records can bind any GitHub, X or Google
  account.
- The verifier contracts that check each proof, and the proving circuits
  they check against.
- The owners of the contracts. The owners of `IdentityRegistry`, the proof
  verifier, the notary service, the platform verifiers and `GoogleJwtRoots`
  can change which proofs are accepted, or upgrade the contracts. Whoever
  controls these keys can bind any account to any address.
- The owner of `HandleEscrow`. It can upgrade the escrow to new code, and
  new code can move the funds it holds or read another registry.
- The owner of `handles.link` and the ENS gateway, if you resolve names
  through ENS. See [How it works](/docs/ens/how-it-works/#what-you-trust).
- The chain your app reads from.

`HandleEscrow` pays whoever `IdentityRegistry` says holds a handle. So every
party above can also redirect funds waiting in the escrow.

The [trust model](/docs/advanced/trust-model/) page goes into more detail.

## When things go wrong

### A platform account is taken over

The attacker can prove the account from
their own address. The newer proof wins, so the identity and its handle now
point to the attacker. Funds sent to the handle, and funds waiting in the
escrow for it, go to the attacker. When the real owner gets the account back,
they can prove it again from their address, and the binding moves back. What was
paid in the meantime is not returned.

### A handle is given to someone else

Once the new holder proves it, the
handle points to them. See
[Identities and handles](/docs/concepts/identities-and-handles/) and
[Resolve a handle](/docs/guides/resolve-handle/#notice-a-new-holder).

### A key or verifier is compromised

The owners can replace a verifier or
remove a notary key. That stops new bad bindings. It does not undo bindings
already written.

## Current status

The contracts have not been audited. They are upgradeable. On each network
one key owns all of them, and on Ethereum mainnet the same key owns
`handles.link` in ENS. See [Security](/docs/resources/security/#admin-keys).

These docs describe libID-contracts v0.21.0, which runs on Sepolia and the
Eden testnet, except `HandleEscrow`, which is not deployed yet. Ethereum
mainnet still runs v0.17.0, which stores every handle
as text, and the id too for GitHub and X. See
[Addresses](/docs/reference/addresses/#network-status).
