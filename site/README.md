# libID website

One static site and Cloudflare Worker: landing page at `/`, Starlight at `/docs/` and `/specs/`.
Add Markdown/MDX with `title` frontmatter in [`docs/pages/`](../docs/pages/).
Specs are published directly from [`specs/`](../specs/).
Six UI colors per theme and one shared logo color live in [`src/palette.mjs`](src/palette.mjs), used by all pages and generated favicons.

## Local

Node.js 22.12+, pnpm 10.30.3. From the repository root:

```sh
pnpm -C site install --frozen-lockfile
pnpm -C site dev
```

Run `pnpm -C site build`, then `pnpm -C site preview` to test search.
Run `pnpm -C site test` for theme and spec-link checks.

## Cloudflare

Worker: **libid**. Root: `/`. Production branch: `main`.
Environment: `NODE_VERSION=22`, `PNPM_VERSION=10.30.3`.

| Command | Value |
| --- | --- |
| Build | `pnpm -C site install --frozen-lockfile && pnpm -C site build` |
| Deploy | `pnpm -C site run deploy` |
| Non-production deploy | `pnpm -C site run deploy:preview` |

`wrangler.jsonc` manages `lib.id` for production and `previews.lib.id` for
Worker Previews. Branch previews use `<preview-name>.previews.lib.id`; the
existing production and preview `workers.dev` URLs remain enabled.

Enable non-production branch builds and Worker Previews in Cloudflare's build
settings, using the commands above. After switching to Worker Previews, set the
Preview command to `pnpm -C site run deploy:preview`: the default
`npx wrangler preview` runs at the repository root and misses `site/wrangler.jsonc`.
`deploy:preview` uses the current Git branch
as the Preview name and updates its isolated deployment. For a local preview
deployment, build the site first, then run `pnpm -C site run deploy:preview`.

Only `dist/` is deployed. The bundled JetBrains Mono license is in `public/fonts/OFL.txt`.
