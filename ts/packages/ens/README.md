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

`ensName` normalizes the handle with the registry's rules from
`@libid/contracts` first, so it takes a handle as a user typed it. It returns
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
- a Gmail address with `+`, `-` or `_` in the local part;
- any other Google address with `_` or `+`.

## Options

```ts
ensName('x', 'alice', { chain: 'base' })                    // 'alice.x.base.handles.link'
ensName('x', 'alice', { parent: 'testnet.handles.link' })   // 'alice.x.testnet.handles.link'
ensName('x', 'alice', { rules: await rulesOf(reader, id) }) // the chain's current rules
```

- `chain` narrows a name to one chain. Without one, the wallet's chain
  decides. Which chain labels a gateway knows is deployment data; `ensName`
  only checks the label's shape and that it is not a platform key.
- `parent` is the name the gateway answers under. It defaults to
  `handles.link`.
- `rules` are the handle rules to normalize with. They default to the rules
  `@libid/contracts` was released with. A chain's owner can change them, so
  pass the ones `rulesOf` reads from the chain when that matters.

A chain label or parent name that is not a lowercase ASCII label of 1 to 63
bytes, or has `--` at its third and fourth characters, throws.

The rules are those of the
[ENS integration spec](../../../specs/ens-integration.md), §5 and §6.
