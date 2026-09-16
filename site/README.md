# libID website

One static site and Cloudflare Worker: landing page at `/`, Starlight at `/docs/`.
Add Markdown/MDX with `title` frontmatter in [`docs/pages/`](../docs/pages/).
Specs stay in `specs/`; their landing-page link is inactive for now.

## Local

Node.js 22.12+, pnpm 10.30.3. From the repository root:

```sh
pnpm -C site install --frozen-lockfile
pnpm -C site dev
```

Run `pnpm -C site build`, then `pnpm -C site preview` to test search.
Run `pnpm -C site test` for theme checks.

## Cloudflare

Worker: **libid**. Root: `/`. Production branch: `main`.
Environment: `NODE_VERSION=22`, `PNPM_VERSION=10.30.3`.

| Command | Value |
| --- | --- |
| Build | `pnpm -C site install --frozen-lockfile && pnpm -C site build` |
| Deploy | `pnpm -C site run deploy` |
| Non-production deploy | `pnpm -C site run deploy:preview` |

Only `dist/` is deployed. The bundled JetBrains Mono license is in `public/fonts/OFL.txt`.
