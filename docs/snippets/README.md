# Docs snippets check

Runs the code in the guides, unchanged, against a fresh local chain. It
pins `@libid/contracts` 0.17.0, the version the pages describe.

The chain it needs is the examples local-chain project (`./start.sh`,
`local.env`, `./bind.sh`). That project is not published yet, so this check
runs only where you have a copy of it, and it is not part of CI.

1. Start a fresh `anvil`.
2. In the local-chain directory, run `./start.sh && source local.env`.
3. From the root of this repository, in the same shell:

```sh
pnpm -C docs/snippets install --frozen-lockfile
LOCAL_CHAIN=/path/to/local-chain pnpm -C docs/snippets check
```

Use a fresh anvil each time: the escrow guide binds `carol`, and a second run
would find her already bound. Add a page to `PAGES` in `check.mjs` when its
code should run.
