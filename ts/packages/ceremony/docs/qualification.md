# Qualification and release prerequisites

Status: **launch qualification incomplete**.
Security/correctness, API ergonomics and simplicity were independently reviewed.
Reasonable findings were fixed and targeted checks rerun. No predecessor review
ledger or completion state is inherited. [TRACEABILITY.md](traceability.md) accounts
for every stable requirement ID, including partial, external and deferred coverage.

## Inputs

| Input | Pin |
|---|---|
| Workspace main | `4f205fdf733e3c137543f5f4a8f7281f74377d02` |
| Architecture PR #13 | `0259e72c184e2be7b78a0ad92188e8722d8d6daf`; eight source documents consolidated with implementation guides in the package docs directory; package composition updated for grouped CCDP documents |
| Popup PR #25 / stack base | `1c5b78c6f9d783f7b5c536f6018d724b3ced9132` |
| Circuits release | `v0.3.0`, commit `91bc3446eeaa50ab2056d88dd9941374aa4fa34c` |
| Latest circuits source checked | `b25bc5b89e595f5bb6049c50446a0edcde47da58`; only README changes after release |
| Noir/Nargo and bb.js | `1.0.0-beta.25`, `5.2.0`; generation and independent verification explicitly use `verifierTarget: 'evm'` |
| Canonical attestation encoder | `libid-rs` `239a4bb426ac72591fe30006f22660e164a98d96` |
| TLSNotary bundle | `libid-org/notary` v0.3.0-rc.3, commit `37e195035e6b11683b09233a8815ae703e3cc55f`; snippet member selected with a directory wildcard |
| SWS | `3.0.0-beta.1`; image digest in `ccdp.Dockerfile` |

The RC replaces the former local TLSNotary bundle. Its exported call shape and
real browser WASM initialization are checked, but those checks do not establish
matched-service protocol compatibility or successful concurrent notarizations.
SWS v3 is currently a prerelease; the exact image is pinned in `ccdp.Dockerfile`.

## Evidence obtained

- TypeScript package/harness checks, declaration emission, workspace formatting and
  lint; focused canonical, authorization, parser, client, cache and worker tests.
- Actual worker-handler tests accept returned transcripts at 4 KiB/32 KiB and reject
  one byte over before `send` resolves, with a deliberately permissive SDK. A missing
  final EOF expires the finalization deadline. These are adapter tests, not real TLSN.
- Native installed ACVM/ABI WASM loaders, bb.js WASM loader and primary/fallback CRS
  loaders run with an observing fetch stub and external hosts blocked. This checks
  request methods, cache modes, URLs, ranges and primary/fallback ordering; synthetic CRS bodies in this probe are never proof evidence.
- Exact per-platform sets, retained immutable responses and
  Brotli/gzip roundtrips. Every emitted HTTP response is checked against actual SWS.
  The deployment image was built and used behind the HTTPS browser harness; only
  its local listening port was changed to accommodate rootless host networking.
- Actual popup launch, native-anchor fallback, private callback forwarding,
  isolation, denial and application continuation in Chromium, Firefox and WebKit.
  A same-script legacy nested registration is seeded; execution joins a delayed
  root-worker prefetch without a second server download.
- Real bearer-link browser proofs in Chromium, Firefox and WebKit and a real Google
  browser proof in Chromium verified against the released keys. Effective proof
  backend observations report shared memory and two threads in this isolated lane.
- Real Google fixture proving in Chromium, Firefox and WebKit through the emitted
  distribution and generated CSP,
  using the actual popup package and a separate released-key verification process.
  Fixture time/JWKS/OAuth return are controlled. WebKit bypasses Playwright routing
  for the controlled-page JWKS fetch, so this one public fixture response is supplied
  at the page fetch boundary. Live JWKS CORS/CSP behavior is not qualified by this
  test; proof assets still use their real native loaders. The fixture uses its own known
  digest: this is runtime/key compatibility, not real consent or authorization for
  the harness transaction. Public-input mutation must fail independent verification.

The positional API and separate identity/proof update passed 197 unit tests,
15 build/loader/native-SWS checks, 50 actual-popup browser cases and five additional
Bridge origin-admission checks across the five profiles. All 20 dev frontend
cases passed. Each profile generated a real Google fixture proof through the new
CCDP result message and independently verified it against the released key.
Security/correctness, API and simplicity reviews found only stale qualification
wording, now corrected. Production Bridge admission remains externally qualified.

The asset API/SWS v3 update passed 184 ceremony unit tests, all 15 build/loader/
actual-SWS checks, and all 50 browser cases across Chromium, Firefox, WebKit,
Android emulation and iOS emulation. Every profile generated a real Google fixture
proof and verified it independently against the released key. Two concurrent
notary RC WASM runtimes initialized in each profile; this does not qualify live
TLSNotary sessions. An earlier WebKit concurrent-popup timeout was not reproduced
in this full run; one passing run does not establish absence of intermittent faults.

The executable matrix is `e2e/flow.spec.ts` plus `playwright.config.ts`. Final run
counts and browser versions are recorded in the PR; ignored local reports carry
controlled fixture outputs. Real OAuth traces, callback URLs, credentials,
transcripts, openings and witnesses are never qualification artifacts.

## Ledger fixture scope

The real `@libid/ledger` package supplies the hash/address interface. Real ledger
definitions and Chain Profile vectors remain deferred. Tests and the development
app import the shared synthetic fixtures explicitly; no module alias or decoder
is involved. Client snapshots their hash and notary address. CCDP contains no
ledger implementation and needs no separate fixture build. This verifies ceremony
integration, not support for a real ledger.

## Actual blockers and unqualified boundaries

1. **Matched notary service:** both single-session and concurrent browser probes
   against `https://notary.testnet.lib.id` reached WASM initialization and WebSocket
   opening but stalled in `Prover.setup`; the single-session run was aborted at
   120 seconds. Proof-backend initialization completed concurrently. Checking the
   earlier 8-KiB SDK receive setting produced the same stall; production keeps the
   documented 32-KiB acceptance ceiling. This is no evidence of real TLSN concurrency
   or a qualified X/GitHub ceremony. Reestablish a matched service/bundle, then run
   the real profiles and correlate every final output.
   A fresh single-session probe with v0.3.0-rc.1 also expired after 120 seconds
   against that development endpoint; the probe does not establish the failing
   protocol stage. The rebuilt standalone Chromium bearer proof passed independent
   released-key verification in the same harness.
   These probes used the development override address, not the newly
   documented `https://testnet.notary.lib.id`. Both fixed network selections and
   matched browser/Bridge sessions remain unqualified against live services.
2. **X request deadline:** REQ-PLAT-33 / LIBID-BROWSER-010 require complete request
   receipt at X before its 30-second authorization-code deadline. The documents do
   not define a browser-observable issuance anchor. The pinned SDK exposes
   request-start and completion only after the response body; it exposes no
   request-direction-only completion signal. A timeout around `send_request()`
   would incorrectly reject allowed later responses. No such substitute is used.
   A matched SDK/service observation contract and delayed-request qualification are
   required before claiming this requirement. This production enforcement remains
   unresolved, not a waived security property.
3. **HTTP profile alignment:** spec PR #31 at
   `5bbd838c81d4a47849104cf0f965ad985b2e5b98` permits additional X/GitHub identity
   headers and explicitly includes GitHub's runtime-chosen User-Agent. That
   specification mismatch is resolved. Browser selectors accept additional identity
   headers and retain byte-exact bearer disclosure as described in
   [notarization](notarization.md#token-layout-alignment). Token headers remain
   closed; existing token-layout requirements and tests are unchanged. Matching
   released-verifier coverage remains a qualification gate.
4. **GitHub service:** no real confidential token-exchange service was qualified.
   Admission checks one revealed request prefix and one committed secret-field
   suffix. Tests use canonical-bincode fixtures modeling native coalescing, not
   live signed service evidence. The selected next qualification target is
   [Bridge PR #10](https://github.com/libid-org/libid-server-rs/pull/10), stacked on
   PR #9, at `054839f43cbad7ed9d9e15a04d2f7ed1118b0c7d`. It uses released libid-rs
   `v0.3.0` (`501f094bf10f776c2227ef345908f507a0c80fd0`), TLSN fork
   `94aaaf33f3361d1218f9abb4c82b5c58a9199460` and MPZ fork
   `1dd2349d52aeea038d77fb0816f781c6b714fe77`, matching notary/browser RC3. Matching
   source pins alone does not establish a successful live session. The Bridge
   must admit exactly one valid `Origin` matching its effective `allowedOrigins`
   independently on every preflight and POST, before DNS or session work. This
   admits configured application origins and the resolved CCDP origin. It must use the Prover-supplied canonical `notaryAddress` unchanged, with no second
   mapping/override, and reject redirects and forbidden internal destinations,
   including DNS-resolved destinations. Unit origin validation is not server egress
   protection; those service controls and both network selections remain unqualified.
5. **Devices and optional carrier:** real iOS/Android devices, native platform apps,
   Vanadium, background scheduling/memory pressure and corresponding optional
   fallback adapters/signaling were unavailable. Desktop engines and mobile
   emulation cannot satisfy these gates. No replacement WebRTC code is supplied.
The nonce/signature-check and released-bound normative amendments are now committed
in architecture PR #13 at `5cfbf47` (included in the pinned documentation head).
They are no longer an uncommitted-source prerequisite.

Callback now ships as `/ccdp/callback.html`, including clearing, bundled version
selection, local unsupported-version UI, and all dependencies. The test Bridge
prepares the HTML and hash-only CSP from this artifact with escaped deployment
JSON. Production Bridge refresh, conditional revalidation, redirect rejection,
compressed-source handling, atomic replacement/last-good retention, and ingress
log redaction still require external deployment qualification; the harness loads
the emitted source at startup and does not implement that server lifecycle.

Complete metrics transport, timing coverage and the full documented diagnostic-span
catalog are deferred by user instruction. Coarse package-owned progress, worker
capability observations and targeted download counts remain. No fabricated zero
metrics, speculative transport, or second protocol message family is introduced.
Real build-time circuit statistics match 42,006 and 179,443 gates and reject
insufficient launch capacity. Negative browser-proof SRS-floor execution and the
complete cache/update fault matrix are not claimed; their remaining properties are retained in the index.

## Implementation deviations with consequences

- `LIBID-OAUTH-003` in the pinned source still names raw `chainId` input, conflicting
  with its updated `LIBID-MOD-014/015` and Client API. The local requirement row keeps
  its ID but names `LedgerId` and a snapshotted hash, matching the current API.

- The pinned SWS v3 beta uses boolean `text-charset = false`. With trailing-slash
  redirects disabled, its header matcher appends the resolved file basename even
  for files; generated exact header rules account for this. Native SWS owns weak
  ETags, conditional responses and encoded representation selection. Compressed
  and range responses may use chunked framing; tests verify body bytes and any
  supplied length instead of requiring a redundant Content-Length.
- Execution workers explicitly carry `Cross-Origin-Embedder-Policy: require-corp`.
  A real Firefox proof otherwise fails before worker bootstrap; the isolated engine
  harness had already supplied this header. The generated policy and immutable URL
  digest now include it for every execution worker, including leaves.
- The known stale `/ccdp/v1/` registration is retired only when all its workers use
  the exact canonical script URL. Root is selected explicitly. Unrelated scopes
  are untouched. Firefox's isolated document can initially be uncontrolled, so a
  same-origin root-worker claim handshake finishes before `ProverReady`. This is
  cache ownership, not popup carrier or MessagePort continuity machinery.
- Callback is self-contained. Prefetch/Prover HTML clears the URL in the first
  inline script before its inline module entry imports dependencies. Build-owned
  worker AST edges expose nested workers to graph traversal; they do not scrape
  generated dependency text or change native Worker execution.
- The build replaces bb.js's unused embedded default-WASM URL modules with its
  owned threaded-WASM URL; actual initialization uses supported `wasmPath`. This
  avoids duplicate embedded WASM chunks. Native CRS hosts/ranges are untouched;
  there is no production fetch interception or external-CRS rehosting.
- Immutable execution paths include a response-policy digest, and compatible
  rebuilds retain prior assets plus their original headers. Promotion must preserve
  that accumulated artifact for the compatibility window. Removal/garbage collection
  requires a separate release decision.
- The final notary finish/frame/EOF phase has a 30-second terminal deadline, separate
  from proof generation and X's authorization-code deadline. It prevents an otherwise
  unbounded incomplete frame from retaining a worker. Real-device timing remains a
  qualification gate. Transcript ceilings are acceptance checks, not network caps.

## Repeatable opt-in real consent

Use a dedicated test application built against this package, a deployed Bridge
allowlisting its HTTPS origin, the emitted CCDP distribution, and real provider
registrations with exact redirect URIs. For GitHub, provision secrets only in the
Bridge's secret store. Do not place secrets in command arguments, reports or chat.

```sh
CEREMONY_WALKTHROUGH_URL=https://your-test-application.example \
CEREMONY_BROWSER=chromium \
  node ts/qualification/ceremony/walkthrough.mjs
```

The runner opens a real headed browser, installs no OAuth mocks, and stops at manual
consent/foreground/suspension/outcome checkpoints. Its ignored report records only
checkpoint labels, browser version and optional application `window.result.status`;
that status is Prover-reported, not verification. Repeat approval and denial for each
platform, app-installed/app-absent and signed-in/signed-out conditions. Never bypass
CAPTCHAs, MFA or provider consent screens.

On physical iOS/Android, repeat the same walkthrough in the system browser and
record model, OS/browser version, declared proof/TLSN thread pools and only nonsecret
outcomes. Exercise suspension, eviction, popup defaults, openerless/same-tab returns,
ignored close and application resumption. A mismatched/absent fallback must fail
closed. Qualify both normal isolation and popup-managed fallback responses.

Separately run `e2e/build-smoke.mjs`, `e2e/server-smoke.mjs` (loopback HTTP port 4686), and
`ts/qualification/ceremony/run-smoke.mjs <browser> <google|bearer|notary|notary-single> [page-url] [notary-origin]`
with the same pinned artifacts. Defaults are `http://localhost:4686` for the smoke
page and `http://localhost:4687` for the dev notary. For an isolated native-SWS
HTTP smoke server and RC3 notary, for example:

```sh
node ts/qualification/ceremony/run-smoke.mjs chromium notary http://localhost:4966/index.html http://localhost:4967
```

Repeat with `firefox`/`webkit`, `notary-single`/`notary`, and both `localhost` and
`127.0.0.1` notary origins. The optional URLs configure this qualification runner
only. The smoke server uses loopback HTTP, so the runner needs no certificate
bypass; all HTTPS connections use normal validation and public HTTP is refused. The notary smoke uses a public unauthenticated
request and records lengths only; it diagnoses runtime concurrency and cannot
replace real X token/identity or GitHub profile qualification. The independent
verifier consumes the released key, never a key recomputed by the proving backend.
No chain, contract deployment, RPC, wallet or local browser verifier is required.

## Asset API implementation choices

- `archive(source, mount)` uses positional arguments by explicit user decision;
  the upstream document's object-shaped example is not retained.
- `file(source, mount, headers)` covers installed standalone WASM. External range
  sizes are derived from Range; full-resource byte counts may be supplied where
  known (G2 is 128 bytes). Unknown full-resource sizes do not become fictitious totals.
- Native SWS may stream a representation with chunked transfer instead of emitting
  Content-Length. Qualification checks actual bytes and any supplied length;
  the build never injects a length to force another serving behavior.

### OAuth parsing and error-reporting changes

GitHub return parsing now checks the advertised issuer and accepts bounded provider
error details. Synthetic parser regressions cover these shapes; they do not qualify
a live GitHub ceremony or the separately reported notary attestation failure.
`AbortCeremony` now carries a closed failure code and its safe message; Client
exposes `CeremonyError` instead of discarding the reason. This is a user-requested
extension of PR #13's reason-only record; deploy matching Client/CCDP builds.
Original causes remain local where retained. Raw diagnostics and a developer modal
remain design work rather than an implicit exception to the privacy boundary.

This fix passed 217 unit tests, 15 native-SWS/build/loader checks, all 55
browser integration cases and 20 dev frontend cases. Every browser profile
received the safe worker-failure code through the actual popup package and
generated a Google fixture proof verified against the released key. TypeScript,
production/development builds and three focused reviews passed.

## Token-layout regression run (2026-09-10)

After the PR #31 layout fixes: 237 unit tests, strict package/build TypeScript,
package emission, formatting and lint pass. Rebuilt CCDP artifacts pass 14
build/loader/native-SWS checks; the separate mutable-root rebuild test was not
configured in this run (one skip). All 55 browser cases pass across Chromium,
Firefox, WebKit and Android/iOS emulation, including Google fixture proofs
independently verified against the released key. Security/correctness, API and
simplicity reviews are clear. These checks do not qualify live X/GitHub sessions;
Bridge PR #9 is the selected next integration target.

## Manual-stack preparation (2026-09-10)

Bridge PR #9 builds with `cargo build --locked` against its existing libid-rs pin.
The actual Bridge served the emitted Callback and public configuration through
trusted mkcert HTTPS; the actual frontend reached Ready. An explicitly synthetic
Google client ID was used only for these pre-consent checks and is not a committed
OAuth registration. `dev:services` starts the local services for the manual flow.
The Callback file override does not qualify upstream refresh/revalidation.

Browser assets now use notary rc.2. All five browser profiles pass concurrent
initialization of the actual WASM bundle. The 237 unit tests and 14 distribution/
loader/native-SWS checks pass (one mutable-root rebuild test skipped); development
TypeScript and lint pass. Security, API and simplicity reviews are clear.

The shared localhost callback URI is confirmed. The registrations and intentionally
public GitHub development credential now live directly in `ts/apps/dev/compose.yaml`;
there is no environment override or separate registration file. Basic network
checks from the development machine found TCP port 7047 on
`notary.testnet.lib.id` timing out and DNS resolution for `testnet.notary.lib.id`
failing. These are reachability observations, not protocol tests: confirm a
reachable compatible notary's HTTPS/WebSocket origin and TCP listener before
spending OAuth codes. No live X/GitHub session or proof delivery was qualified.

## Container dev stack (2026-09-10)

`dev:services` now builds the pinned Bridge PR #9 using its upstream Dockerfile
and starts it alongside notary 0.3.0-rc.2 and the pinned SWS image. The browser
distribution is rebuilt with the local notary origin. No host Rust is needed.
Linux validation used Docker Compose with an isolated Podman engine; Docker
Desktop and Apple Silicon emulation have not been exercised here.

Trusted mkcert HTTPS passed the real Bridge config/Callback and SWS header checks;
the actual frontend admitted all three development OAuth registrations. The
notary's image healthcheck passed, `/info` exposed the development key, and the
WebSocket handshake passed through the local HTTPS ingress. The existing Chromium
smoke completed one real TLSNotary session and then two concurrent sessions,
including receipt and decoding of their final attestations, against the local
released notary. These use unauthenticated requests to the public X endpoint;
they establish transport/runtime concurrency for this probe, not successful
OAuth exchange, platform proofs, or full X/GitHub ceremony qualification.

Development TypeScript/lint and all 237 unit tests pass. Security/correctness,
API ergonomics and simplicity reviews completed. Fixes removed the old generic
multi-child launcher wrapper and corrected teardown ordering: terminate the owned
Compose startup process group before the final `compose down`. A real lifecycle
regression then passed startup, SIGTERM, exit status 0, all six service ports closed
and no remaining project containers.

## Shared development app

The local frontend and Docker services now live in the private `@libid/dev`
workspace package at [ts/apps/dev](../../../apps/dev/README.md). From `ts/`,
`pnpm dev` starts both, while `pnpm dev:services` and `pnpm dev:app` start them
separately. Ceremony retains its distribution builder and qualification harnesses.

Migration validation: all 236 ceremony unit tests and the moved TLS unit test pass;
all 25 dev-app browser tests pass across Chromium, Firefox, WebKit and mobile
emulation. App build, TypeScript and lint pass. The combined workspace command
served the real Bridge configuration, CCDP and notary through trusted HTTPS, and
its frontend reached Ready with all three registrations. SIGTERM closed all seven
ports and removed its Compose containers. A builder regression also rejects
fixture output outside a worktree-relative `.cache` even when the checkout itself
is below a cache directory. The three focused reviews are clear after correcting
fresh-checkout dependency builds, legacy credential ignores and that output guard.

## Ledger-owned notary routing

Architecture PR #13 at
[`0259e72c184e2be7b78a0ad92188e8722d8d6daf`](https://github.com/libid-org/libid/commit/0259e72c184e2be7b78a0ad92188e8722d8d6daf)
defines the implemented routing contract. Client snapshots ledger inputs, and the
shared CCDP distribution consumes the supplied address without a ledger dependency.

- `LedgerId` exposes `hash()` and `notaryAddress()`; encoding, decoding and
  `isTestnet()` leave the ceremony contract. Real ledger definitions remain deferred.
- Client copies the exact 32-byte hash once. X/GitHub also read and validate one
  canonical HTTPS notary origin before OAuth. Missing/throwing methods and invalid
  results fail construction; later mutation cannot change a run. Google never
  calls the address method and sends null.
- `AppStartProver.notaryAddress` replaces its encoded ledger field. Prover has no
  ledger dependency or notary defaults. All X sessions and GitHub's token and
  identity sessions use the same address; failures never switch destinations.
- CCDP embeds no notary addresses or development overrides. The application can
  wrap the shared ledger fixture with a local address while retaining its hash.
- Prover `connect-src` becomes `https: wss:`; dedicated TLSNotary workers also
  admit `wss:` where they open notary connections. This admits secure network
  destinations beyond the selected notary. Script and worker
  sources remain restricted to the emitted graph; Bridge egress restrictions
  and ledger verification authority remain unchanged.

Client and CCDP must be deployed together because the request shape changes.
Verification keeps IDs LIBID-MOD-014/015, LIBID-ASSET-003, LIBID-OAUTH-021,
LIBID-PROVER-008, KIT-013/015/017 and CSP-003/011: snapshot/mutation and invalid-input
checks, byte-identical distribution policies for different addresses, both
isolation paths, and matching addresses in real GitHub/X sessions. The pending
notary image update remains a separate live-qualification prerequisite.

The header audit also found stale explanatory prose in spec §5.2 claiming the
X token Host is hidden; its normative disclosure table reveals the token head.
The normative table and token-layout requirements control implementation.

Validation of this routing/header update: 263 ceremony unit tests, the ledger
fixture check, all 15 distribution/loader/native-SWS checks, and package/build/
browser/development TypeScript checks pass. All 45 ceremony integration cases
pass across Chromium, Firefox, WebKit and both mobile emulations, including real
TLSNotary WASM initialization. The 55 development-frontend cases also pass after
rerunning Chromium alone; overlapping browser suites initially reported
`ERR_INSUFFICIENT_RESOURCES` before page navigation. Security/correctness, API and
simplicity reviews are clear after documentation corrections. No new real OAuth,
browser-proof verification, or matched-notary session qualification is claimed by
these checks. Restart the development stack to load matching Client and CCDP builds.

## Local HTTP qualification — 2026-09-10

The development application and services now use HTTP/WS on explicit localhost
origins. Bridge [PR #10](https://github.com/libid-org/libid-server-rs/pull/10),
stacked on PR #9, is pinned at `86d6fcfd8be6bf9155fe67394f517c3ce74a9d44`.
It admits canonical local HTTP notary origins; its existing configured TCP
connection remains unchanged. The dev stack waits for CCDP's Callback endpoint
before starting Bridge, which retrieves Callback directly over HTTP. No Callback
file override, TLS proxy or mkcert setup is involved.

Validation used a separate Docker Compose project on ports 4962/4963/4967 to
preserve the existing live stack. The built Bridge, pinned notary RC and native
SWS passed configuration, origin admission, Callback composition, isolated-route
and real WebSocket checks. Chromium, Firefox and WebKit each confirmed a secure
context, cross-origin isolation, and a real local-notary WS handshake under the
emitted Prover CSP, without certificate bypasses.

- 97 popup and 270 ceremony unit tests passed.
- 55 development UI cases passed on HTTP across the five browser profiles.
- The shared ceremony suite covered 88 cases across five HTTPS and three HTTP
  profiles. All HTTP cases passed, including real Google fixture proofs verified
  outside the browser against the released key. The initial suite had one HTTPS
  WebKit two-popup timeout (87/88); its first targeted retry also timed out, then
  the diagnostic run and final unmodified test both passed. This remains an
  intermittent test result, not a demonstrated production fix.
- All 15 distribution/real-loader/native-SWS checks passed, with no skips.
- Bridge's 75 unit and 39 HTTP tests, TypeScript checks, lint and formatting passed.
- Security/correctness, API and simplicity reviews completed; canonical-loopback
  validation and CCDP startup readiness findings were fixed.

HTTPS qualification remains in the suite on ports 4881–4883; HTTP uses 4781–4783.
The TLSNotary asset mount is `tlsn/v0.3.0-rc.2-loopback` because its worker response
policy changed. Old immutable responses remain available. Public provider traffic
and external proving assets still require HTTPS. Physical-device testing still
needs HTTPS and its own reachable origins. No new live OAuth consent or matched
notary-session qualification was performed in this run.


## Notary RC3 qualification (2026-09-10)

Browser assets and the dev server now use `v0.3.0-rc.3`; its new immutable mount
is `tlsn/v0.3.0-rc.3`. The Bridge uses the matching TLSN/MPZ revisions listed above,
including the active-context lifetime fix. The released libid-rs tag resolves to
the same `501f094` source previously pinned by revision.

Twelve real TLSNotary cases passed: Chromium 151.0.7922.34, Firefox 153.0 and
WebKit 26.5, each with one and two concurrent sessions against both
`http://localhost` and `http://127.0.0.1` notary origins on an isolated custom port.
All pages were secure contexts and cross-origin isolated under the emitted
COOP/COEP fallback response. Each session exchanged real HTTPS traffic with
`api.x.com` and received a final canonical attestation frame while a real proof
backend initialized concurrently. The test reveals an unauthenticated response
and checks its correlation and framing, not its signature or a platform identity.
WebKit concurrent runs took about 30 seconds; no runtime deadlock was observed.
These timings were collected during other builds, not as a performance benchmark.

All 33 HTTP browser integration cases passed, including real Google fixture
proofs independently verified against the released key in each engine. All 15
distribution, actual-loader and native-SWS checks passed without skips. The Bridge
passed 75 unit and 39 HTTP tests, and its RC3 container built with `--locked`.

This does not qualify live OAuth success, the normal DIP response with real
notarization, public WSS/mobile networks, physical devices, or request-selected
Bridge routing. The last remains a separate reported Bridge bug; its native
notary connection still comes from server configuration. No requirement IDs
or remaining qualification gates were removed.

The isolated Docker stack passed Bridge startup, Callback retrieval and public
configuration admission. A native Bridge MPC-TLS probe reached GitHub and read
its refusal response, but returned 502: the public development GitHub App still
rejects `http://localhost:4682/auth/callback`. Direct synthetic invalid-code probes
returned `redirect_uri_mismatch` for HTTP and `bad_verification_code` for the old
HTTPS callback. The registration must be updated before live HTTP GitHub consent
qualification. No valid code/token was used, and neither probe establishes a
successful confidential token exchange or its final attestation.


## Explicit same-origin fetch policy (2026-09-10)

All asset-fetching response profiles now explicitly include `'self'` in
`connect-src`, matching architecture PR #13 at `83a7fbcd071abeb62aa2cfd6f9cc91933175a328`.
The TLSN mount is now `tlsn/v0.3.0-rc.3-csp1` so the original mount's immutable
worker headers remain unchanged. Local CCDP origins already accept HTTP without
a certificate or development flag; client configuration checks cover both exact
loopback hosts and a CCDP port distinct from Bridge. Public HTTP stays rejected.

The GitHub callback registration blocker recorded above was resolved after the
user updated the provider configurations: the HTTP callback probe now returns
the expected `bad_verification_code`, rather than `redirect_uri_mismatch`. This
checks registration acceptance, not live OAuth success.

Validation after the policy change: 38 focused client/protocol tests, all 16
distribution/real-loader/native-SWS checks, and all 33 HTTP browser cases passed
across Chromium, Firefox and WebKit, including independently verified real Google
fixture proofs and concurrent TLSN initialization. TypeScript, lint and formatting
passed. Security/correctness, API and simplicity reviews had no findings.


### JSON whitespace compatibility fix

Manual Firefox GitHub execution exposed a valid `/user` response with a space
following `"id":`. Allowing JSON whitespace in the identity transcript parser
let that manual ceremony complete. This was not a released-verifier acceptance
result: the prior Rust and Solidity readers also assumed compact field prefixes.

The coordinated patch accepts JSON whitespace around colons in X/GitHub token
and identity fields, and before GitHub integer terminators. Original transcript
bytes, reveal offsets and bearer-only commitments are preserved. Existing
compact fixtures remain covered; whitespace, malformed numbers, duplicate
spellings and framing regressions have focused tests. Release/pin updates and
end-to-end qualification against the updated verifier remain required before
claiming released-stack compatibility.
