---
title: Packages
description: TypeScript and Rust packages for the libID contracts.
sidebar:
  order: 4
---

## TypeScript: `@libid/contracts`

```sh
npm install @libid/contracts viem
```

These docs describe version 0.17.0, which matches libID-contracts v0.17.0.
The package works with [viem](https://viem.sh). It has:

- ABIs: `identityRegistryAbi`, `handleEscrowAbi`, and the other contracts.
- Reading helpers: `resolveHandle`, `resolveId`, `resolveHandleAndId`,
  `publishedHandleOf`, `identityCount`, `identitiesOf`, `rulesOf`.
- Keys: `platformId`, `handleHash`, `handleNode`.
- Handle rules: `normalize`, `RULES_GITHUB`, `RULES_X`, `RULES_GOOGLE`.

The reading helpers take a reader, `{ client, address }`, where `client` is a
viem public client and `address` is `IdentityRegistry`. They return `null` where
the contract returns a zero address or an empty string.

Source and README:
[ts/packages/contracts](https://github.com/libid-org/libID-contracts/tree/main/ts/packages/contracts).

## Rust: `libid-contracts`

```sh
cargo add libid-contracts
```

Bindings for the contracts, built on [alloy](https://alloy.rs). See
[docs.rs/libid-contracts](https://docs.rs/libid-contracts).
