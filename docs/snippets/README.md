# Docs snippets check

Runs the code in the guides, unchanged, against a fork of Sepolia. It pins
`@libid/contracts` 0.21.0, the version the pages describe. CI runs it on
every change to `docs/pages` or `docs/snippets`.

Each page gets a fresh `anvil` fork at a fixed block, `FORK_BLOCK` in
`check.mjs`. The guides' data, such as the GitHub handle `testyakly`, is
bound on Sepolia at that block, so the output the pages show stays the same.
Transactions use anvil's funded test keys and stay on the fork.

You need Node.js 22.12 or later and [Foundry](https://getfoundry.sh)
(`anvil`, `forge`, `cast`). From the root of this repository:

```sh
pnpm -C docs/snippets install --frozen-lockfile
pnpm -C docs/snippets check
```

`FORK_URL` picks the Sepolia RPC; the default is
`https://sepolia.gateway.tenderly.co`. It must serve state and logs at old
blocks; many free RPCs do not. `FORK_PORT` picks anvil's port, 8645 by
default.

A block right after `<!-- check: skip, <reason> -->` is not run. The check
prints each skip with its reason. Add a page to `PAGES` in `check.mjs` when
its code should run.

When a guide needs newer chain state, move `FORK_BLOCK` forward and update
the output the pages show.
