# Docs snippets check

Runs the code in the guides, unchanged, against a fresh
[local chain](https://github.com/libid-org/examples/tree/main/local-chain).

1. Start a fresh `anvil`.
2. In `examples/local-chain`, run `./start.sh && source local.env`.
3. From the root of this repository, in the same shell:

```sh
pnpm -C docs/snippets install --frozen-lockfile
LOCAL_CHAIN=/path/to/examples/local-chain pnpm -C docs/snippets check
```

Use a fresh anvil each time: the escrow guide binds `carol`, and a second run
would find her already bound. Add a page to `PAGES` in `check.mjs` when its
code should run.
