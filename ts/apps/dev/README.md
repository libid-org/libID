# @libid/dev

Local application for testing real ceremonies with the OAuth Bridge, notary and
CCDP distribution. It uses a synthetic ledger fixture and submits no transactions.

## Run

Use the workspace's Node and pnpm setup, plus Docker with Compose. No host Rust
toolchain or local certificates are needed.

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
Browsers connect directly to the notary in peer mode; repeated development runs
have no per-client rate quotas.

## Configure and develop

Edit configuration directly where it is used:

- [compose.yaml](compose.yaml): services.
- [bridge-config.toml](bridge-config.toml): Bridge configuration and development OAuth credentials.
- [local.ts](local.ts): the app origin (frontend port), and the Bridge and notary URLs.
- [src/app.ts](src/app.ts): the local ledger fixture; Bridge configuration selects CCDP.

The setup includes shared development OAuth credentials and a public development
notary signing key; no environment file is needed. Bridge publishes the GitHub
`clientCredential` from its platform configuration. OAuth registrations must use
**`http://localhost:4682/auth/callback`**. To connect another application, add its
exact origin, an HTTPS subdomain pattern such as `*.lib.id` (default port only),
or `*` to `allowed_app_origins` in `bridge-config.toml`.

Frontend edits reload through Vite. After changing ceremony or popup source,
run this in another terminal while `pnpm dev` stays running:

```sh
pnpm dev:ccdp
```

It rebuilds the packages and static distribution, then recreates only CCDP.
Bridge, notary and the app stay running; no Docker images are built. Refresh
the app and start a fresh ceremony to use updated Prover/Prefetch code.
The Bridge caches Callback
([refresh rules](https://github.com/libid-org/libID/blob/66096eb1d31ea7007c2749ab1e26d15da5714f4d/specs/oauth-bridge.md#callback-document)),
so restart `pnpm dev` after Callback changes. Also restart after changing service
configuration or dependency images. Bridge runs from its released container image.

To run services and frontend separately:

```sh
pnpm dev:services
# Another terminal:
pnpm dev:app
```

Choose a platform and complete provider consent. Multiple ceremonies can run at
once, including for the same platform. Each history row has its own status and
Close button. Success and denial close only that run’s popup automatically;
failed popups remain open for DevTools inspection and can be closed with the same
button while its connection remains usable. The Close control disappears when
the connection ends. Reported closure marks the run Interrupted; detected
transport failure reports its error. With a native-anchor launch, Close becomes
available after the popup authenticates and can be controlled.
Results are available in `window.results`, a Map keyed by each row's
`data-ceremony-id`. See the [manual qualification checkpoints](../../packages/ceremony/docs/testing.md#manual-consent-and-device-checks); the displayed outcomes alone do not establish cryptographic verification.

## Checks

```sh
pnpm --filter @libid/dev typecheck
pnpm --filter @libid/dev... build
pnpm --filter @libid/dev test:e2e
```

The browser tests use port 4692 and intercepted responses for smoke coverage of
launch/close, outcomes, concurrent runs and a representative timing display.
Protocol validation and event ordering belong to the ceremony and popup suites;
the dev suite does not exhaustively test timing arithmetic, sorting or delayed
delivery, or retest native disclosure controls. Real OAuth and proving checks are documented in the
[ceremony qualification guide](../../packages/ceremony/docs/qualification.md).

Run history shows core operation durations from their occurrence timestamps, plus
total ceremony time. The status uses the package’s stage
projection. Timings freeze at the terminal outcome and clear on page reload;
interrupted operations are marked, and overlapping durations are not added together.

When isolation fallback occurs, **Prover fallback** shows navigation through Prover
readiness, using `prover-fallback` and `prover.started` occurrence timestamps. It
excludes work before navigation and does not measure the difference from a run
without fallback. Direct runs have no fallback row.

## Live tests

The live suite proves real GitHub, X and Google accounts from this app's UI.
It starts its own `pnpm dev` and stops it after, so the ports above must be
free.

```sh
LIBID_TEST_ENV_FILE=path/to/.env.test pnpm --filter @libid/dev test:live
```

The variables carry the names libid-server-rs' ceremony-tests uses, so one
`.env.test` serves both suites; keep it outside the repository, or name it
`.env.test`, which git ignores. Unless `LIBID_LIVE_PLATFORMS` lists it, a
platform whose variables are missing is skipped.

| Variable | Platform | What |
|---|---|---|
| `GH_TEST_ALICE_USERNAME`, `GH_TEST_ALICE_PASSWORD` | GitHub | The test account. |
| `GH_TEST_ALICE_TOTP_SECRET` | GitHub | The base32 key of its authenticator app. |
| `X_TEST_ALICE_USERNAME` | X | The test account's handle. |
| `X_TEST_ALICE_COOKIES` or `X_TEST_ALICE_COOKIES_FILE` | X | A saved session: base64 of the JSON cookie list from `ceremony export x`, or a path to that JSON, relative to the env file. |
| `GOOGLE_TEST_ALICE_EMAIL` | Google | The test account. |
| `GOOGLE_TEST_ALICE_COOKIES` or `GOOGLE_TEST_ALICE_COOKIES_FILE` | Google | A saved session, made by hand: see [Google's session](#googles-session). |
| `LIBID_TEST_ENV_FILE` | — | A dotenv file with the variables above; exported values win. |
| `LIBID_LIVE_PLATFORMS` | — | Comma-separated platforms to prove, such as `github,x`; each one listed must have its variables. Unset, every platform with its variables runs. |
| `LIBID_TEST_PROXY` | — | A proxy for the browser's traffic, loopback aside. |
| `LIBID_STACK_LOGS` | — | A file all of the stack's output, the build's included, is appended to. |
| `HEADED` | — | Set: show the browser. |

In CI, [live-e2e.yml](../../../.github/workflows/live-e2e.yml) runs GitHub and X
daily in one job, and Google in another through a proxy whose address Google
accepts. Each job gets only its own platforms' secrets. On a failure it prints
the end of the stack log to the job log, where GitHub masks the secrets, and
uploads the screenshots.

### Google's session

Google challenges a saved session used from an address other than the one it
was signed in from, and refuses sign-in in an automated browser. So the session
is made once by hand, through the same proxy CI uses:

1. Open the proxy locally:
   `aws ssm start-session --target <LIBID_GOOGLE_PROXY_INSTANCE> --document-name AWS-StartPortForwardingSession --parameters portNumber=3128,localPortNumber=3128`.
2. In plain Chrome with a fresh profile, sign in to the test account through it:
   `google-chrome --user-data-dir=/tmp/google-session --password-store=basic --proxy-server=http://127.0.0.1:3128 https://myaccount.google.com/`.
   Then close Chrome.
3. Export and store it: `node e2e/export-session.ts /tmp/google-session google.json`,
   then `base64 -w0 google.json | gh secret set GOOGLE_TEST_ALICE_COOKIES`, and
   delete `google.json` and the profile.

Do this again when the Google job reports an expired session, or when the
proxy's address changes.
