# libID website

The landing page is plain HTML, CSS, and a small theme switch, with no build step
or runtime dependencies. [The docs app](docs/) uses Starlight and deploys separately.

## Layout

- `../docs/pages/` — published documentation source content.
- `docs/` — Starlight app for `docs.lib.id`, deployed as the `libid-docs` Worker.
- `../specs/` — protocol specification source content.
- `public/` — published website files, including `/docs/` and `/specs/` placeholders.
- `wrangler.jsonc` — Cloudflare Workers static assets configuration.

Keep content in the root directories. The Docs link opens `docs.lib.id`; the Specs
link remains inactive. Only `public/` is uploaded by the landing page deployment.
The docs app publishes only `../docs/pages/`, excluding internal review notes.

## Preview and check

From the repository root:

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory site/public
node site/theme.test.mjs
```

Open <http://localhost:8787>. To preview Cloudflare's routing, run
`npx wrangler@4 dev --config site/wrangler.jsonc` instead.

## Deploy

```sh
npx wrangler@4 deploy --config site/wrangler.jsonc
```

For Cloudflare Workers Builds, use `/` (repository root), leave the build command
empty, and set these commands explicitly:

- Deploy: `npx wrangler@4 deploy --config site/wrangler.jsonc`
- Non-production branch deploy: `npx wrangler@4 versions upload --config site/wrangler.jsonc`

Set the Worker name to `libid`. Connect the desired domain in the Worker settings
after deployment. The separate docs Worker settings are in [docs/README.md](docs/README.md).

Uses [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/);
no Worker script is needed.

## Font

JetBrains Mono Regular is self-hosted from the official
[v2.304 release](https://github.com/JetBrains/JetBrainsMono/tree/v2.304).
Its SIL Open Font License is included in `public/fonts/OFL.txt`.
