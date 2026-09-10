# @libid/dev

A minimal application using the public ceremony Client API and actual popup package.
It makes real Bridge requests and launches the emitted CCDP pages; it has no mock
Bridge, OAuth exchange or proof-delivery mode. The frontend works while the Bridge
is unavailable: launch stays disabled with an error; reload the page once the
service becomes available. There is no manual connection button.

From the TypeScript workspace:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **https://localhost:4691**. `pnpm dev` builds the workspace dependencies and
starts Bridge, notary and CCDP, waits for Bridge configuration to respond, then
starts the frontend. For separate terminals use
`pnpm dev:services` and `pnpm dev:app`. These root commands delegate to this private
workspace package; it has no published library API.

Install Docker with Compose (Docker Desktop on macOS); no host Rust or SWS binary
is needed. The frontend and mkcert HTTPS ingress run in Node. Other applications
can connect to the same services; add their exact origins to the Bridge's
`ALLOWED_APP_ORIGINS` in [compose.yaml](compose.yaml) when doing so.

## Configuration

Copy `.env.example` to `.env.local` inside `ts/apps/dev` if the
defaults do not match your local services. When upgrading from the ceremony-owned
setup, move your existing `ts/packages/ceremony/dev/.env.local` here; Git cannot
move that untracked credential file for you. The old location remains ignored.

| Setting | Default |
|---|---|
| `CEREMONY_BRIDGE_ORIGIN` | `https://localhost:4682` |
| `CEREMONY_CCDP_ORIGIN` | `https://localhost:4683` |
| `CEREMONY_APP_PORT` | `4691` (occupied ports fail instead of silently moving) |
| `CEREMONY_TLS_CERT`, `CEREMONY_TLS_KEY` | Generated localhost certificate in `.cache/dev/` |

Only the two public origins enter the browser bundle. OAuth client IDs come from
Bridge configuration. The local launcher defaults to the public registrations in
[oauth-clients.json](oauth-clients.json), so they are declared once.
Client secrets belong exclusively to the Bridge.

Install `mkcert` first (`brew install mkcert` with Homebrew; Firefox on macOS also
needs `brew install nss`). On the first `dev` startup, the script runs `mkcert -install`
and generates a trusted localhost certificate. Installation may ask for your
administrator password. **Restart your browser once if it still shows a warning.**

The CA is reused across projects on this machine. The issued certificate and key
are kept in `.cache/dev/localhost.pem` and `localhost-key.pem` across dev sessions;
restarting the server does not regenerate them or reinstall trust. Missing or expired
certificates are regenerated. The older self-signed `cert.pem` is no longer used.
If you remove the CA from your trust store, run `mkcert -install` to restore trust.

The same localhost certificate can serve Bridge and CCDP on different ports. Other
machines/devices need their own trust setup. To use existing certificates instead,
set both `CEREMONY_TLS_CERT` and `CEREMONY_TLS_KEY` to absolute paths; this skips
mkcert entirely. `build` does not generate certificates or install trust.

Configure the Bridge to allow the application's exact origin and publish the same
CCDP origin as the app's popup allowlist. Register the Bridge callback URL with the
OAuth providers. The app shows only platform versions supported by both Client and
Bridge. [OAuth Bridge](../../packages/ceremony/docs/oauth-bridge.md) specifies that service's contract.

## Synthetic ledger and CCDP

Vite aliases `@libid/ledger` to the shared `@libid/ledger/testing` export.
The app uses `test:testnet`, a bogus ledger with a synthetic hash, a fixed development
operation domain and fixed transaction bytes. Each ceremony still generates fresh
protocol randomness. No wallet, chain, contract or transaction submission is involved.
There is no separate duplicate ledger definition in this frontend.

The launcher invokes ceremony's existing distribution builder, emitting the
synthetic-ledger distribution into this app's `.cache/ccdp/`. It pins the local
notary address to `https://localhost:4687`. Build input downloads still use the
builder's existing cache in the ceremony package. A production CCDP rejects
this synthetic ledger. For independent deployments see
[browser tests](../../packages/ceremony/docs/browser-tests.md).

The frontend imports the built public ceremony, popup and ledger packages.
`dev` and `dev:app` build them before starting Vite; restart after changing a
library package. Frontend edits use Vite's normal live reload.

## Walkthrough and checks

Click a platform button and complete real provider consent. Run history records each
attempt’s start time, platform, outcome and duration, newest first, until page reload. Cancel ends ceremony
work; Close popup releases the application-owned connection during a run. The app
automatically closes the popup after success, denial or cancellation. On failure it
keeps the popup open for DevTools inspection; close it before starting another attempt. The ceremony library does not own this UI decision.
The result summary never displays raw OAuth returns or attestations. An accepted
result is retained only in `window.result` for the existing opt-in walkthrough and
manual inspection; it is not written to storage or logged. Failed and cancelled
attempts expose only their status there. An accepted result means proof delivery,
not independent verification. The app does not verify browser proofs itself.

```sh
pnpm --filter @libid/dev typecheck
pnpm --filter @libid/dev... build
pnpm --filter @libid/dev test:e2e
# Also exercise a Bridge and CCDP sharing one origin:
CEREMONY_CCDP_ORIGIN=https://localhost:4682 pnpm --filter @libid/dev test:e2e --project chromium
```

The focused browser tests run on port 4692 in all five existing Playwright profiles.
They intercept Bridge configuration and an inert Prefetch page to check unavailable/
retry behavior, platform admission, actual popup/native-anchor launch and cancellation.
These tests establish frontend behavior only, not real OAuth or proof generation.
`build` emits the frontend to `.cache/dev/app`. Neither this app nor its ledger
alias is included in ceremony's production build.

A complete walkthrough still requires a compatible live Bridge and CCDP. See
[qualification](../../packages/ceremony/docs/qualification.md#repeatable-opt-in-real-consent) for the manual runner,
released-key verification and the remaining live notary/device gates.

## Real local services

[compose.yaml](compose.yaml) runs three services:

- Bridge [PR #9](https://github.com/libid-org/libid-server-rs/pull/9), pinned at
  `ebbf10961dd6960a4d53c0af6470bee1f889a229`. Docker retrieves the Git build context
  and runs the upstream Dockerfile, including Cargo. The first build takes time;
  later launches reuse the image layers. Its `libid-rs` pin is `501f094`.
- Notary **0.3.0-rc.2**, matching the browser WASM's TLSN revision `8a5de746`.
  This released image is amd64 only; Apple Silicon requires Docker Desktop's
  amd64 emulation. Native ARM and physical mobile qualification remain separate.
- SWS **3.0.0-beta.1**, using the same image digest as ceremony's `ccdp.Dockerfile` and
  read-only mounts of the emitted distribution and its header configuration.

The notary uses a **public development signing key** (scalar 1). Its attestations
are for this local harness only; no production ledger should trust that key.
Bridge shares the notary's container network namespace: `tcp://localhost:7047`
and the browser's `https://localhost:4687` therefore name the same notary host,
without changing Bridge's host correlation check. TCP 7047 is not published.
The HTTPS ingress forwards WebSocket upgrades and binary streams unchanged.

Set `GH_OAUTH_CLIENT_SECRET` in the ignored `.env.local` when GitHub is enabled.
Only Bridge receives it; it is never a build argument or image layer. Public
registrations default to [oauth-clients.json](oauth-clients.json).
`CEREMONY_PLATFORMS` can override these with another registration or a subset.
Native binary paths and `NOTARY_URL` are no longer launcher settings.

Register **`https://localhost:4682/auth/callback`** with each provider. Google also
needs the appropriate consent-screen/test-user configuration; X must use a public
client with PKCE; GitHub needs the matching confidential secret on the Bridge.
The public development IDs are committed in `oauth-clients.json`; secrets
remain local. All three committed registrations are configured for the callback
URL above. Changing it requires updating their provider registrations.

From the TypeScript workspace:

```sh
pnpm dev:services
# Another terminal:
pnpm dev:app
# A read-only pre-consent check (Node 24+ system trust, including mkcert):
NODE_USE_SYSTEM_CA=1 pnpm --filter @libid/dev dev:check
```

`dev:services` uses the fixed default origins and HTTPS ports 4682 (Bridge),
4683 (CCDP), 4687 (notary), plus internal loopback ports 4684 (SWS), 4685 (Bridge)
and 4688 (notary HTTP/WS). Keep the frontend's default origin/port. Port conflicts
fail instead of selecting another callback URI. Containers belong to a Compose
project derived from the checkout path. Ctrl-C stops the frontend (when started
together), HTTPS ingress and that project's containers; Docker retains images for subsequent sessions. Wait for
Bridge startup before opening a separately started frontend. The combined `dev`
command waits automatically; Ctrl-C or a Compose failure ends the wait.

The Bridge reads the rebuilt Callback using its supported
`CALLBACK_ARTIFACT_PATH` override. PR #9's retrieval client uses compiled public CA
roots and cannot retrieve the mkcert-served CCDP. This file mode permits local
consent testing without disabling certificate verification; it does **not** test
upstream retrieval/revalidation. Rebuild CCDP and restart the services after
Callback changes. Qualify retrieval separately against a publicly trusted CCDP.

`dev:check` exercises actual configuration and origin admission, checks that
Callback composition omits request data, and checks the isolated Prover route.
It also reads the real notary public key and opens its WebSocket endpoint. This
establishes reachability only; it does not complete a TLSNotary session, exchange
an OAuth code, or generate a proof.
