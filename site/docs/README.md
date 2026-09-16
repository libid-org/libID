# libID docs

[Starlight](https://starlight.astro.build/) generates the static documentation site
at **https://docs.lib.id**. The landing page remains a separate site and Worker.

## Content and assets

- `../../docs/pages/` — published Markdown/MDX pages. Add `title` frontmatter to each
  page; folders become URL paths and the sidebar updates automatically.
- `../../docs/reviews/` — internal review notes, outside the published collection.
- `../../specs/` — specification sources, not published by this app.
- `src/` — site configuration and styling.
- `src/content/docs` — symlink to `../../docs/pages/`, using Starlight's standard
  content loader and automatic sidebar.
- `public/fonts` and `public/favicon.svg` — symlinks to the landing page's assets,
  including the font license. Astro copies them into the built site.
- `dist/` — generated output, ignored by Git.

## Develop

Use Node.js 22.12+ and pnpm 10.30.3. From the repository root:

```sh
pnpm -C site/docs install --frozen-lockfile
pnpm -C site/docs dev
```

To test the production build, including search:

```sh
pnpm -C site/docs build
pnpm -C site/docs preview
```

## Cloudflare Workers Builds

Create a separate Worker named **libid-docs**, connected to this repository:

| Setting | Value |
| --- | --- |
| Root directory | `/` (repository root) |
| Build command | `pnpm -C site/docs install --frozen-lockfile && pnpm -C site/docs build` |
| Deploy command | `pnpm -C site/docs run deploy` |
| Non-production branch deploy command | `pnpm -C site/docs run deploy:preview` |
| Production branch | `main` |

Set the build environment variables `NODE_VERSION=22` and
`PNPM_VERSION=10.30.3`. The explicit working directory is important for both
production and branch builds to find the docs configuration.

The [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
`docs.lib.id` is declared in `wrangler.jsonc`. Production deployment provisions
it when `lib.id` is an active zone in the same Cloudflare account. Branch uploads
create preview versions; view their preview URLs to check changes before merging.

For a local configuration check after building:

```sh
pnpm -C site/docs exec wrangler deploy --dry-run
```
