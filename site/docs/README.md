# libID docs

Starlight site for **docs.lib.id**. Add Markdown/MDX pages with `title` frontmatter
in [`docs/pages/`](../../docs/pages/).

## Local

Node.js 22.12+, pnpm 10.30.3. From the repository root:

```sh
pnpm -C site/docs install --frozen-lockfile
pnpm -C site/docs dev
```

Run `pnpm -C site/docs build`, then `pnpm -C site/docs preview` to test search.

## Cloudflare

Worker: **libid-docs**. Root: `/`. Production branch: `main`.
Environment: `NODE_VERSION=22`, `PNPM_VERSION=10.30.3`.

| Command | Value |
| --- | --- |
| Build | `pnpm -C site/docs install --frozen-lockfile && pnpm -C site/docs build` |
| Deploy | `pnpm -C site/docs run deploy` |
| Non-production deploy | `pnpm -C site/docs run deploy:preview` |

`wrangler.jsonc` configures `docs.lib.id`; the `lib.id` zone must be in the same
Cloudflare account.
