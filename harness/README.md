# Integration harness

Everything needed to run a real, manual, end-to-end handle claim against a
local chain: anvil, the factory-first contract stack (declaratively applied
by libid-deploy 0.6.0), the released notary, libid-server-rs and keeper
images, and the buttons-only demo UI on top of `@libid/claim`.

The local addresses **equal the canonical cross-network addresses**: every
entry contract deploys through the deterministic `LibidFactory`
(`0xa92244c3f4462aad08bd1a33c3940b9b936321ad` on every chain) via CREATE3
with `salt = keccak256(canonical name)`, so e.g. `IdentityNames` is
`0xd467d48769c26faee36ba6b6fc9228f14aef6dd2` here *and* on every production
network. What you test locally is address-identical to production.
`libid-deploy plan --print-addresses` prints the full table offline.

Since libid-deploy 0.4.0 `network.local.toml` is **declarative**: every
canonical address is pre-declared, chain state decides what still needs
deploying, and `apply` never rewrites the file — so the harness applies it
straight off its read-only mount and there is no regeneration step, ever.

Automation of the click-through itself (captured-credentials driving a real
browser — the original monorepo has prior art with chromiumoxide) is the
next phase; today
the harness boots the stack and a human clicks. The `integration-smoke` CI
job already automates everything up to the consent screen: stack boot, the
declarative-deploy convergence check, the keeper's real JWKS rotation, and
API-level assertions.

## One command

```sh
harness/boot.sh
```

which does, in order:

1. **asset staging** — builds `@libid/claim-full` (which fetches its
   bundled assets: the tlsn wasm bundle from the `libid-org/notary`
   release, the compiled circuits from `libid-org/libid-circuits`
   sha256-verified against the release manifest, and noir's acvm/abi wasm
   from `node_modules`) and runs its `libid-claim-assets` bin to copy the
   tree into `ts/apps/demo/public/` (gitignored).
   Prereq: `pnpm -C ts install` has run.
2. **`render-env.sh`** — parses the committed `network.local.toml` into
   `harness/.env` (compose interpolation) and `ts/apps/demo/.env.local`
   (VITE_ vars, including the anvil #4 dev-fallback signer so no wallet
   extension is needed). Both outputs are generated, never committed.
3. **`docker compose up --wait`** — the stack below.
4. Health checks (anvil RPC, notary `/info`, backend `/health`) + a status
   table.
5. The vite dev server, foreground, at `http://localhost:5173`. Exit tears
   the stack down (`KEEP_STACK=1` to keep it).

## The compose stack

| Service | Image | Role |
|---|---|---|
| `anvil` | `ghcr.io/foundry-rs/foundry:v1.5.1` | chain 31337, `--code-size-limit 65536` (the Honk verifiers exceed EIP-170); the default Arachnid CREATE2 predeploy is kept on purpose — `ensure_*` is idempotent and the canonical addresses are the same either way |
| `deploy` | `debian:bookworm-slim` (one-shot) | downloads released `libid-deploy` 0.6.0 for the container arch, fresh-applies the declarative network file on its read-only mount, **asserts convergence** (below) |
| `notary` | `ghcr.io/libid-org/notary:0.2.0` | MPC-TLS/ProxyMode notary; TCP 7047 + HTTP/WS 7048; also serves the JWKS notarization duty |
| `keeper` | `ghcr.io/libid-org/keeper:0.2.0` (one-shot) | one real rotation tick: MPC-TLS reading of Google's live JWKS through the notary, then `rotate()` on `identity_jwks_roots` and `google_oidc_verifier` |
| `libid-server-rs` | `ghcr.io/libid-org/libid-server-rs:0.2.2` | GitHub OAuth + MPC-TLS proof service on 8722; also serves the Google fragment relay |

Two addresses that look confusable and are not: the notary's
`VERIFYING_CONTRACT_ADDRESS` (and the backend's, same value) is
**GitHubIdentityVerifier**; the notary's `X_ZK_VERIFIER_ADDRESS` is
**XIdentityVerifier**. Both come from `network.local.toml` via
`render-env.sh`.

### No runtime address hand-off, by construction

The deployed addresses are a pure function of their canonical names
(CREATE3 through the frozen-address factory), known before anything is
deployed and declared in `network.local.toml`. Compose wires them as
static env. Determinism is enforced by `libid-deploy` itself:
`validate` rejects any declared canonical key that differs from
`predict_address(factory, name)`, and `apply` aborts via its
predict-equality canary if a deploy would land anywhere else. The one-shot
`deploy` service fresh-applies the file directly on its read-only mount
(apply never writes) and then asserts via `plan --json` that no
`"deploy"`-status item remains — if `libid-deploy` or the embedded
bytecode ever changes upstream, the boot fails loudly instead of the
addresses silently drifting away from the static wiring.

There is no regeneration procedure: the file is declarative and never
rewritten. After an upstream contract change, a new `libid-deploy` release
ships a new canonical address table, and this file's declared values must
be updated to match `plan --print-addresses` (validation fails until they
do).

### The JWKS keeper: Google claims work locally

The identity stack deploys `identity_jwks_roots` (and the login stack's
`google_oidc_verifier`) with an **empty** trust list, so Google claims
would revert with `UntrustedModulus` on a virgin chain. The one-shot
`keeper` service closes that gap with the real production path, not a
mock: one `keeper once` tick polls Google's live JWKS, obtains an MPC-TLS
notarized reading of `https://www.googleapis.com/oauth2/v3/certs` through
the stack's notary (whose signing key, anvil #1, is exactly the signer the
on-chain `Notary` contract trusts), and submits `rotate()` to both JWKS
contracts with anvil #5 as pure gas money. It exits 0 only when every
rotation landed — after boot, Google claims verify locally. Requires
outbound HTTPS to `www.googleapis.com`; config in `harness/keeper.toml`
(static, committed). For a long-lived rotation loop instead of the
one-shot: `docker compose run --rm keeper --config /input/keeper.toml run`.

## Manual test procedure

Prereqs (once):

* Docker, pnpm 10, node ≥ 20.
* **GitHub OAuth App** (the flow that works out of the box): create a plain
  OAuth App with callback URL exactly `http://localhost:8722/auth/github/callback`,
  then put its credentials in a git-ignored `.env` at the repo root —
  `GH_OAUTH_CLIENT_ID=…` and `GH_OAUTH_CLIENT_SECRET=…`, one per line.
  `boot.sh` sources it automatically (exporting them into compose); a bare
  `export …` before boot works too. Without them the stack boots with
  dummies and everything except the GitHub consent screen works.
* **X** (optional): an X OAuth2 app with redirect URI
  `http://localhost:5173/zk/x-popup`, and its client id in
  `network.local.toml` (`[platforms] x_client_id`) *before* boot — the id
  is baked into the on-chain verifier at deploy time. Addresses do not
  move when inputs change (CREATE3 addresses depend only on the canonical
  name, not constructor args).
* **Google** (optional): an OAuth client with redirect URI
  `http://localhost:8722/auth/gmail/callback`, its client id in
  `network.local.toml` (`[platforms] google_client_id`) before boot. The
  JWKS trust roots are populated by the harness's own `keeper` service on
  every boot (a real MPC-TLS rotation through the notary — see above), so
  the historical `UntrustedModulus` gap is closed and Google claims work
  locally out of the box.

Then:

1. `harness/boot.sh` — wait for the status table and the vite banner.
2. Open `http://localhost:5173`.
3. **Connect wallet** — with no extension installed the demo falls back to
   the anvil #4 dev key (the page says "(dev key)").
4. Pick **GitHub**, leave "Publish the handle" checked, click **Claim my
   GitHub handle**, authorize in the popup.
5. Expected: status walks through the backend poll → "Signing…" → the
   claim transaction lands → the page reads the name back and shows
   "*handle* now resolves to your wallet" (that read-back is
   `resolveId(platform, userId) == holder`).
6. Paste your handle or the holder address into **Resolve** and confirm
   both directions.
