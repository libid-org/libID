# @libid/dev

Local application for testing real ceremonies with the OAuth Bridge, notary and
CCDP distribution. It uses a synthetic ledger fixture and submits no transactions.

## Run

Use the workspace's Node and pnpm setup, plus Docker with Compose. Docker Desktop
on macOS needs amd64 emulation for the notary image. No host Rust toolchain or
local certificates are needed.

From the TypeScript workspace:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:4691**. The command builds dependencies and CCDP, starts
Docker services, waits for Bridge readiness, then starts the frontend. The first
build takes longer; later launches reuse cached downloads and container layers.
Ctrl-C stops the app and that checkout's containers.

| Service | Local URL |
|---|---|
| Application | http://localhost:4691 |
| OAuth Bridge | http://localhost:4682 |
| CCDP | http://localhost:4683 |
| Notary HTTP/WebSocket | http://localhost:4687 |

These are separate browser origins. Ports are fixed and services bind to loopback.

## Configure and develop

Edit configuration directly where it is used:

- [compose.yaml](compose.yaml): services, OAuth registrations and allowed application origins.
- [src/app.ts](src/app.ts): Bridge/CCDP URLs and the local ledger/notary fixture.
- [vite.config.ts](vite.config.ts): frontend port.

Compose includes shared development OAuth credentials and a public development
notary signing key; no environment file is needed. OAuth registrations must use
**`http://localhost:4682/auth/callback`**. To connect another application, add its
exact origin to Bridge's `ALLOWED_APP_ORIGINS` in Compose.

Frontend edits reload through Vite. Restart `pnpm dev` after changing a library
package or CCDP source to rebuild it. To run services and frontend separately:

```sh
pnpm dev:services
# Another terminal:
pnpm dev:app
```

Choose a platform and complete provider consent. Failed popups remain open for
DevTools inspection. Successful proof delivery leaves the result in `window.result`
for inspection; independent verification is part of the
[qualification walkthrough](../../packages/ceremony/docs/qualification.md#repeatable-opt-in-real-consent).

## Checks

```sh
pnpm --filter @libid/dev typecheck
pnpm --filter @libid/dev... build
pnpm --filter @libid/dev test:e2e
```

The browser tests use port 4692 and cover frontend behavior with intercepted
responses. Real OAuth and proving checks are documented in the
[ceremony qualification guide](../../packages/ceremony/docs/qualification.md).
