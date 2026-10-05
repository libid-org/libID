# @libid/ens

The ENS name of a libID handle. A name is derived from the handle alone, so
there is nothing to register: the libID gateway reads the handle back out of
the labels and answers with its holder.

```ts
import { ensName } from '@libid/ens'

ensName('github', 'octocat')            // 'octocat.github.handles.link'
ensName('x', '@Some_Handle')            // 'some-handle.x.handles.link'
ensName('google', 'alice@gmail.com')    // 'alice.google.handles.link'
ensName('google', 'alice@company.com')  // 'alice._at.company.com.google.handles.link'
ensName('x', 'alice', { chain: 'base' }) // 'alice.x.base.handles.link'
```

`ensName` normalizes the handle first with the handle rules
`@libid/contracts` was released with, which the gateway applies on every
chain, so it takes a handle as a user typed it. It returns
`null` when a handle has no name, and throws `HandleError` for text that is
not a handle on that platform. `HandleError` is re-exported from
`@libid/ens`, so `instanceof` works without importing `@libid/contracts`.

## Install

```sh
npm install @libid/ens viem
```

viem is a peer dependency. `@libid/contracts/identity`, where the
normalization lives, imports viem when it loads, so `@libid/ens` does too.

## Rules

| Platform | Handle | Name labels |
| --- | --- | --- |
| GitHub | `octocat` | the handle |
| X | `some_handle` | every `_` becomes `-` |
| Google, Gmail | `alice.smith@gmail.com` | the local part, split at dots |
| Google, other domains | `alice@company.com` | the local part, `_at`, then the domain |

These handles have no name:

- an X handle whose third and fourth characters are both `_`, which ENS
  reserves (`ab__cd` would be `ab--cd`);
- a Gmail address with `+`, `-` or `_` in the local part, or an empty piece
  (`.alice@`, `alice.@`, `a..b@`);
- any other Google address with `_` or `+`, an empty piece, `_at` as a piece,
  or a piece whose third and fourth characters are both `-` (ENSIP-15 reserves
  them, so `xn--` domains have no name);
- a handle with a piece longer than 63 bytes, which DNS cannot carry.

## Options

```ts
ensName('x', 'alice', { chain: 'base' })                  // 'alice.x.base.handles.link'
ensName('x', 'alice', { parent: 'testnet.handles.link' }) // 'alice.x.testnet.handles.link'
```

- `chain` narrows a name to one chain. Without one, the wallet's chain
  decides. Which chain labels a gateway knows is deployment data; `ensName`
  only checks the label's shape and that it is not a platform key.
- `parent` is the name the gateway answers under. It defaults to
  `handles.link`.

ENS asks the nearest name that has a resolver. A chain label that names a
subname with a deployment of its own is answered by that deployment, so
`ensName('x', 'alice', { chain: 'testnet' })` and
`ensName('x', 'alice', { parent: 'testnet.handles.link' })` give the same
name. A deployment's chain labels must not name such a subname; `ensName`
cannot see which subnames have one.

A chain label or parent name that is not a lowercase ASCII label of 1 to 63
bytes, or has `--` at its third and fourth characters, throws.

The rules are those of the [ENS integration spec](https://github.com/libid-org/libID/blob/91215f6ea2bb0d700a0ec5090cf6f4625cea2821/specs/ens-integration.md), §5 and §6.

[`vectors/names.json`](https://github.com/libid-org/libID/blob/main/ts/packages/ens/vectors/names.json)
in the repository lists names with their handles, handles with no name, and
names that read back as no handle. The tests here run it forward through
`ensName` and back through this package's own reading of the spec. The
gateway's inverse does not read this file yet; it should check against the
same file.
