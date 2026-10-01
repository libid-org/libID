---
title: Security
description: Audit status, admin keys, and how to report a problem.
sidebar:
  order: 3
---

## Audits

The libID contracts, circuits and notary have not been audited.

## Admin keys

The contracts are upgradeable proxies. Their owners can upgrade them and
change which proofs are accepted. On the Eden testnet, one key owns every
contract. See [What a binding proves](/docs/concepts/trust/#whom-you-trust)
for what the owner of a contract can do.

## Reporting a problem

Please do not open a public issue for a security problem. Contact the
maintainers of [libid-org](https://github.com/libid-org) privately.
