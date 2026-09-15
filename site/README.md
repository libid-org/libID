# libID website

Plain HTML, CSS, and a small theme switch. No build step or runtime dependencies.

## Layout

- `../docs/` — documentation source content.
- `../specs/` — protocol specification source content.
- `public/` — published website files, including `/docs/` and `/specs/` placeholders.
- `wrangler.jsonc` — Cloudflare Workers static assets configuration.

Keep content in the root directories. Once a docs engine is chosen, configure it
to read those sources and publish to `/docs/` and `/specs/`. Only `public/` is
uploaded today; source documents are not published yet.

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

For Cloudflare Workers Builds, use `site` as the root directory, leave the build
command empty, and set the deploy command to `npx wrangler@4 deploy`. Set the
Worker name to `libid`, or change it in the config. Connect the desired domain
in the Worker settings after deployment.

Uses [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/);
no Worker script is needed.

## Font

JetBrains Mono Regular is self-hosted from the official
[v2.304 release](https://github.com/JetBrains/JetBrainsMono/tree/v2.304).
Its SIL Open Font License is included in `public/fonts/OFL.txt`.
