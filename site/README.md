# libID website

One static site and Cloudflare Worker: landing page at `/`, Starlight at `/docs/` and `/specs/`.
Add Markdown/MDX with `title` frontmatter in [`docs/pages/`](../docs/pages/).
Specs are published directly from [`specs/`](../specs/).
`/SKILL.md` serves [`skills/link-handle`](../skills/link-handle/SKILL.md); `/link/agent/` launches it and hands the bind call to the agent at `/api/agent-link/<session>`.
Six UI colors per theme and one shared logo color live in [`../brand/palette.json`](../brand/palette.json), used by the website, favicons and CCDP screens, which also share the Libron font in [`../brand/libron/`](../brand/libron/).

## Local

Node.js 26+, pnpm 11.25.0. From the repository root:

```sh
pnpm -C site install --frozen-lockfile
pnpm -C site dev
```

Run `pnpm -C site build`, then `pnpm -C site preview` to test search.
Run `pnpm -C site test` for theme and spec-link checks.

## Cloudflare

Worker: **libid**. Root: `/`. Production branch: `main`.
Environment: `NODE_VERSION=26`, `PNPM_VERSION=11.25.0`.

| Command | Value |
| --- | --- |
| Build | `pnpm -C site install --frozen-lockfile && pnpm -C site build` |
| Deploy | `pnpm -C site run deploy` |
| Non-production deploy | `pnpm -C site run deploy:preview` |

Cloudflare caches assets at the edge. `public/_headers` gives fingerprinted
`/_astro/` assets a one-year browser cache; HTML, favicons, and search files
keep Cloudflare's default revalidation so updates remain fresh.
Keep cacheable fonts in `src/assets/` and reference them through imports or CSS
so Astro changes their URLs when their contents change.

`wrangler.jsonc` manages the `lib.id` and `www.lib.id` production custom domains
and `previews.lib.id` for Worker Previews. Cloudflare manages their DNS and HTTPS
certificates. Configure a zone-level Single Redirect rule matching
`http.host eq "www.lib.id"`, with a dynamic target of
`concat("https://lib.id", http.request.uri.path)`, status `301`, and query-string
preservation enabled. The custom-domain entry provisions the hostname; the
redirect rule sends visitors to the apex domain.

Branch previews use `<preview-name>.previews.lib.id`; the existing production
and preview `workers.dev` URLs remain enabled.

Enable non-production branch builds and Worker Previews in Cloudflare's build
settings, using the commands above. After switching to Worker Previews, set the
Preview command to `pnpm -C site run deploy:preview`: the default
`npx wrangler preview` runs at the repository root and misses `site/wrangler.jsonc`.
Existing previews retain their own build settings. Apply the build command,
Preview command, and environment versions above to each existing preview too.
`deploy:preview` uses the current Git branch
as the Preview name and updates its isolated deployment. For a local preview
deployment, build the site first, then run `pnpm -C site run deploy:preview`.

All website text uses self-hosted
[Libron v0.31](https://github.com/nicoverbruggen/libron/releases/tag/v0.31),
with its license in `../brand/libron/LICENSE`, published as `/fonts/libron/LICENSE`.
