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
not a handle on that platform.

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

A chain label narrows a name to one chain. Without one, the wallet's chain
decides. Which chain labels a gateway knows is deployment data; `ensName` only
checks the label's shape.

The rules are those of the
[ENS integration spec](../../../specs/ens-integration.md), §5 and §6.
