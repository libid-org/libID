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

Open **http://localhost:4691**. `pnpm dev` builds the workspace dependencies and
starts Bridge, notary and CCDP, waits for Bridge configuration to respond, then
starts the frontend. For separate terminals use
`pnpm dev:services` and `pnpm dev:app`. These root commands delegate to this private
workspace package; it has no published library API.

Install Docker with Compose (Docker Desktop on macOS); no host Rust or SWS binary
is needed. The frontend runs in Node; Docker publishes the services directly over HTTP. Other applications
can connect to the same services; add their exact origins to the Bridge's
`ALLOWED_APP_ORIGINS` in [compose.yaml](compose.yaml) when doing so.

## Configuration

Development configuration is fixed in the files that consume it:

- [Compose](compose.yaml) defines the Bridge/notary/SWS services, OAuth registrations
  and intentionally public GitHub development credential.
- [Frontend](src/app.ts) names Bridge, CCDP and the local-notary ledger fixture.
- [Vite](vite.config.ts) serves the application on HTTP port 4691.
- [Service launcher](services.ts) builds CCDP and starts Compose and Vite.

No environment file or credential provisioning is needed. Existing `.env.local`
files are no longer loaded by the launcher. The four browser origins remain
separate through their ports; they share the localhost site.

No certificates, mkcert, administrator access or browser restart are needed.
HTTP is allowed only for exact `localhost` and `127.0.0.1` hosts. Browser isolation
headers remain enabled. Public deployments and testing from another physical device
still use HTTPS; accessing a LAN address over HTTP is not supported.

Configure the Bridge to allow the application's exact origin and publish the same
CCDP origin as the app's popup allowlist. Register the Bridge callback URL with the
OAuth providers. The app shows only platform versions supported by both Client and
Bridge. [OAuth Bridge](../../packages/ceremony/docs/oauth-bridge.md) specifies that service's contract.

## Synthetic ledger and CCDP

The app wraps the shared `@libid/ledger/testing` testnet fixture with
`notaryAddress: () => 'http://localhost:4687'`. Its hash stays synthetic, with a
fixed development operation domain and transaction bytes. Each ceremony generates
fresh protocol randomness. No wallet, chain or transaction submission is involved.

The launcher emits the normal shared CCDP distribution into `.cache/ccdp/`.
No ledger definitions or notary addresses are compiled into that artifact; the
client supplies the local address at runtime. Build downloads reuse the ceremony
package's existing cache. For independent deployments see
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
```

The focused browser tests run on port 4692 in all five existing Playwright profiles.
They intercept Bridge configuration and an inert Prefetch page to check unavailable/
retry behavior, platform admission, actual popup/native-anchor launch and cancellation.
These tests establish frontend behavior only, not real OAuth or proof generation.
`build` emits the frontend to `.cache/dev/app`. Neither this app nor its ledger
fixture is included in ceremony's production build.

A complete walkthrough still requires a compatible live Bridge and CCDP. See
[qualification](../../packages/ceremony/docs/qualification.md#repeatable-opt-in-real-consent) for the manual runner,
released-key verification and the remaining live notary/device gates.

## Real local services

[compose.yaml](compose.yaml) runs three services:

- Bridge [PR #10](https://github.com/libid-org/libid-server-rs/pull/10), stacked on
  [PR #9](https://github.com/libid-org/libid-server-rs/pull/9), pinned at
  `054839f43cbad7ed9d9e15a04d2f7ed1118b0c7d`. Docker retrieves the Git build context
  and runs the upstream Dockerfile, including Cargo. The first build takes time;
  later launches reuse the image layers. Its `libid-rs` pin is release `v0.3.0` (`501f094`).
- Notary **0.3.0-rc.3**, matching the browser WASM and Bridge TLSN revision
  `94aaaf33` and MPZ revision `1dd2349d`.
  This released image is amd64 only; Apple Silicon requires Docker Desktop's
  amd64 emulation. Native ARM and physical mobile qualification remain separate.
- SWS **3.0.0-beta.1**, using the same image digest as ceremony's `ccdp.Dockerfile` and
  read-only mounts of the emitted distribution and its header configuration.

The notary uses a **public development signing key** (scalar 1). Its attestations
are for this local harness only; no production ledger should trust that key.
Bridge shares the notary's container network namespace: `tcp://localhost:7047`
and the browser's `http://localhost:4687` therefore name the same notary host,
without changing Bridge's host correlation check. TCP 7047 is not published.
Docker publishes the notary HTTP/WebSocket listener directly; there is no Node proxy.
CCDP shares the same namespace so Bridge can retrieve `http://localhost:4683/ccdp/callback.html`
using exactly the origin it publishes to browsers.

The GitHub development credential is committed directly in
[compose.yaml](compose.yaml), alongside the public OAuth client registrations.
This registration uses PKCE; its client identity is intentionally public and cannot
authenticate a trusted application. Only Bridge receives the credential at runtime;
it is not a build argument or image layer.

Register **`http://localhost:4682/auth/callback`** with each provider. Google also
needs the appropriate consent-screen/test-user configuration; X must use a public
client with PKCE; GitHub needs the matching confidential secret on the Bridge.
The public development IDs and matching GitHub development credential are committed
in `compose.yaml`. Provider registrations must match the callback URL above. The registrations have been updated to HTTP; a synthetic GitHub probe confirmed
that its token endpoint accepts the HTTP callback. Live consent remains a separate check.

From the TypeScript workspace:

```sh
pnpm dev:services
# Another terminal:
pnpm dev:app
```

`dev:services` uses fixed HTTP ports 4682 (Bridge), 4683 (CCDP) and 4687
(notary HTTP/WS); the frontend uses 4691. All published ports bind to host loopback.
Port conflicts fail instead of selecting another callback URI. Containers belong
to a Compose project derived from the checkout path. Ctrl-C stops the frontend
(when started together) and that project's containers; Docker retains images.
The combined `dev` command waits for Bridge readiness before starting the frontend.

Bridge retrieves and revalidates Callback directly from CCDP. No Callback file
mount or certificate exception is used. Rebuild CCDP after changing its source.
