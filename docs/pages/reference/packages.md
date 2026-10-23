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

These docs describe version 0.19.0, which matches libID-contracts v0.19.0.
The package works with [viem](https://viem.sh). It has:

- ABIs: `identityRegistryAbi`, `handleEscrowAbi`, and the other contracts.
  `bindErrorsAbi` has every error a `bind` can revert with.
- Reading helpers: `resolveHandle`, `resolveId`, `resolveHandleAndId`,
  `primaryHandleOf`, `identityCount`, `identitiesOf`.
- Keys: `platformId`, `handleNode`, `idNode`, `foldedHandleNode`.
- Handle and id rules: `normalize`, `checkId`, `RULES_GITHUB`, `RULES_X`,
  `RULES_GOOGLE`.
- Call builders: `calls`, one per state-changing function.
- Bind payloads: `encodeTlsNotaryProof`, `encodeGoogleProof`.

`handleNode`, `idNode`, `foldedHandleNode` and the rules are also in
`@libid/contracts/platforms`, which loads without viem.

The reading helpers take a reader, `{ client, address }`, where `client` is a
viem public client and `address` is `IdentityRegistry`. They return `null` where
the contract returns a zero address or an empty string.

Source and README:
[ts/packages/contracts](https://github.com/libid-org/libID-contracts/tree/main/ts/packages/contracts).

## Rust: `libid-contracts`

```sh
cargo add libid-contracts
```

Bindings for the contracts, built on [alloy](https://alloy.rs) 2. See
[docs.rs/libid-contracts](https://docs.rs/libid-contracts).

For your tests, the `testing` feature adds `StubPlatformVerifier`, a
platform verifier that accepts any binding without a proof. Enable it in
`[dev-dependencies]` only.

## Rust: `libid-identity`

```sh
cargo add libid-identity --features node
```

Handle and id rules, and with the `node` feature the nodes a binding is
stored under. See [docs.rs/libid-identity](https://docs.rs/libid-identity).
