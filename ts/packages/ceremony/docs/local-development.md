# Local development application

A minimal application using the public ceremony Client API and actual popup package.
It makes real Bridge requests and launches the emitted CCDP pages; it has no mock
Bridge, OAuth exchange or proof-delivery mode. The frontend works while the Bridge
is unavailable: launch stays disabled, and Retry connection fetches configuration
again when the service becomes available.

From the TypeScript workspace:

```sh
pnpm install --frozen-lockfile
pnpm --filter @libid/ceremony dev
```

Open **https://localhost:4691**. This command builds popup and starts Vite for the
frontend only. Bridge, CCDP and notary startup remain separate until the Bridge
integration is ready. No container/image is silently substituted for those services.

## Configuration

Copy `dev/.env.example` to `dev/.env.local` inside the ceremony package if the
defaults do not match your local services:

| Setting | Default |
|---|---|
| `CEREMONY_BRIDGE_ORIGIN` | `https://localhost:4682` |
| `CEREMONY_CCDP_ORIGIN` | `https://localhost:4683` |
| `CEREMONY_APP_PORT` | `4691` (occupied ports fail instead of silently moving) |
| `CEREMONY_TLS_CERT`, `CEREMONY_TLS_KEY` | Generated localhost certificate in `.cache/dev/` |

Only the two public origins enter the browser bundle. OAuth client IDs come from
Bridge configuration. Client secrets belong exclusively to the Bridge.

For manual testing, configure an already trusted localhost certificate/key using
absolute paths, and trust the Bridge/CCDP certificates too. The automatic self-signed
certificate is a convenience for frontend development, retained across restarts and
valid for one year. It is not automatically trusted; replace it with a trusted
certificate before real OAuth/device qualification. Nothing modifies your system
trust store. Both certificate settings must be supplied together.

Configure the Bridge to allow the application's exact origin and publish the same
CCDP origin as the app's popup allowlist. Register the Bridge callback URL with the
OAuth providers. The app shows only platform versions supported by both Client and
Bridge. [OAuth Bridge](oauth-bridge.md) specifies that service's contract.

## Synthetic ledger and CCDP

Vite aliases `@libid/ledger` to the existing shared `@libid/ledger/testing` source.
The app uses `test:testnet`, a bogus ledger with a synthetic hash, a fixed development
operation domain and fixed transaction bytes. Each ceremony still generates fresh
protocol randomness. No wallet, chain, contract or transaction submission is involved.
There is no separate duplicate ledger definition in this frontend.

Build the matching CCDP using:

```sh
pnpm --filter @libid/ceremony build:qualification-artifacts
```

Serve `.cache/qualification-assets` through the real SWS image and your local HTTPS
ingress as described in [browser tests](browser-tests.md). That build uses the same
fixture decoder. A production CCDP rejects this synthetic ledger. Select a compatible
notary using the existing build-time `LIBID_NOTARY_ADDRESS` override if needed.

## Walkthrough and checks

Choose a platform, launch, and complete real provider consent. Cancel ends ceremony
work; Close popup releases the application-owned connection. Completed ceremonies
leave the connection available until you close it, then another attempt can start.
The result summary never displays raw OAuth returns or attestations. An accepted
result is retained only in `window.result` for the existing opt-in walkthrough and
manual inspection; it is not written to storage or logged. Failed and cancelled
attempts expose only their status there. An accepted result means proof delivery,
not independent verification. The app does not verify browser proofs itself.

```sh
pnpm --filter @libid/ceremony typecheck:dev
pnpm --filter @libid/ceremony build:dev
pnpm --filter @libid/ceremony test:dev
# Also exercise a Bridge and CCDP sharing one origin:
CEREMONY_CCDP_ORIGIN=https://localhost:4682 pnpm --filter @libid/ceremony test:dev --project chromium
```

The focused browser tests run on port 4692 in all five existing Playwright profiles.
They intercept Bridge configuration and an inert Prefetch page to check unavailable/
retry behavior, platform admission, actual popup/native-anchor launch and cancellation.
These tests establish frontend behavior only, not real OAuth or proof generation.
`build:dev` emits the frontend to `.cache/dev/app`; neither dev code nor its ledger
alias is included in the package's production build.

A complete walkthrough still requires a compatible live Bridge and CCDP. See
[qualification](qualification.md#repeatable-opt-in-real-consent) for the manual runner,
released-key verification and the remaining live notary/device gates.
