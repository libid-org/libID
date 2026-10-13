---
title: Trust model
description: Every party libID relies on, what each can do if it misbehaves, and what limits the damage.
sidebar:
  order: 5
---

[What a binding proves](/docs/concepts/trust/) is the short version. This page
lists each party, from the [specification](/specs/#system-model-and-specification-ownership).

| Party | Trusted for | If it misbehaves |
| --- | --- | --- |
| The user | choosing the account and approving the binding | nothing beyond their own account |
| The app | running the sign-in flow and its configuration | can refuse to work, but cannot change the account, the wallet, or the proof's time limits |
| The platform (GitHub, X, Google) | saying who owns an account | can bind any account on that platform |
| The notary | signing true records of the user's GitHub and X sessions, and of Google's key list | can bind any GitHub or X account, and, by sending a false key list to `GoogleJwtRoots.rotate`, any Google account |
| Google's signing keys | signing true sign-in tokens | a stolen key can bind any Google account |
| The proof verifier and platform verifiers | checking proofs correctly | a faulty one accepts false bindings for every platform it covers |
| The contract owners | choosing verifiers and keys, and upgrading | can change every rule, and so bind any account; can upgrade `HandleEscrow` and move the funds it holds |
| The chain | ordering transactions and reporting time | the usual risks of the chain |

## What limits the damage

- A proof names one holder and one operation, and the holder must send it
  itself. A stolen proof cannot bind a different address.
- Each proof can be used once, and an older proof cannot replace a newer one.
- Replacing a verifier or a key stops new bindings made with it. It does not
  undo bindings already written.

## What is not covered

The specification lists what it does not defend against: a user misreading a
platform's consent screen, a compromised browser or build of the sign-in
flow, and several parties colluding. See
[Enforceable guarantees](/specs/#enforceable-guarantees-and-accepted-boundaries).
