# Qualification

The implementation is not fully qualified for release. This page records the
current evidence and remaining gaps; [traceability](traceability.md) accounts
for every stable row in the [test index](test-plan.md). Passing parser or
orchestration tests is not cryptographic, live-OAuth, or physical-device evidence.

## Pinned integration

| Input | Qualified source |
|---|---|
| Circuits | v0.3.0, `91bc3446eeaa50ab2056d88dd9941374aa4fa34c` |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0; explicit `verifierTarget: 'evm'` |
| Browser notary bundle | v0.3.0-rc.3, `37e195035e6b11683b09233a8815ae703e3cc55f`; immutable mount `tlsn/v0.3.0-rc.3-csp1` |
| TLSN / MPZ | `94aaaf33f3361d1218f9abb4c82b5c58a9199460` / `1dd2349d52aeea038d77fb0816f781c6b714fe77` |
| Development Bridge | PR #10 at `cdc16551114070ea3458ef0d5ceb19ca4228833e`, on PR #9 at `991d5c604acdb1a67099f28cbf37ad58b6c317a5`; libid-rs v0.4.0 (`82bc4e286d762531ba3ac86996db4afc6ea38f56`) |
| SWS | 3.0.0-beta.1, exact image in [ccdp.Dockerfile](../ccdp.Dockerfile) |
| HTTP framing | Spec PR #31 at `860075a4bf288dc7fee20866ed3536dc260f4574` |

The [normative browser contracts](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md) are maintained separately.
The implementation differences below are explicit, not competing contracts.

## Pending contract updates

1. **Fixed Callback path — coordinated Bridge migration deferred.**
   Current config contains `callbackPath`; Client resolves it against the Bridge
   origin and GitHub's token request includes the frozen `redirectUri`.
   The spec fixes `/auth/callback`, removes `callbackPath` from config, and
   removes `redirectUri` from that token request. Client, CCDP, tests, and the
   separately deployed Bridge need a coordinated change; it remains separate
   from the outcome/event migration below.

## Outcome and event migration

The codecs and documents follow spec PR #13 at
`d266091d8638d375cb0a809e6b081e414c1218d8`: valid platform denial uses
`UserDenied`, technical failure uses `CeremonyFailed`, and optional event metadata
is nested under `instrumentation`. Retired message names and top-level metadata
are rejected. Application and CCDP artifacts must be updated together.

The application cancels by closing its supplied connection. The package exposes
neither `Ceremony.cancel()` nor `CancelError`; the development app exposes a plain
Close button and observes the resulting connection failure. Connection loss is never
provider denial. Native-anchor Close stays disabled until
authentication provides a controllable popup. No cancellation notification
is sent to Callback or Prover. Cancellation while retaining the same connection
for further navigation is outside the current API; completed/denied connections
remain available for normal application continuation.

The migration passed 428 unit tests, package/build/browser type checks, and
style checks. All 85 development browser cases passed before review; after the
closure/readiness fixes, all 40 targeted launch, cancellation, and concurrent-run
cases passed across Chromium, Firefox, WebKit, and mobile emulation. The 64
selected ceremony browser cases passed across desktop HTTP/HTTPS and mobile
emulation, including actual popup navigation, denial, failure, exact-origin
rejection, and released-key verification of browser-generated Google fixture
proofs. All 17 distribution/native-loader/SWS checks passed, including the separately
run native SWS cache-invalidation check. These checks add no
live-OAuth, matched-notary concurrency, or physical-device qualification.

The subsequent Close-button simplification passed all 90 development browser
cases, including automatic success/denial closure and independent concurrent
runs. After extending Close to a popup whose input preparation failed, all ten
concurrency/startup rechecks passed. Closing a failed popup preserves its original
outcome.

4. **Platform-independent notary input.**
   Client still skips the ledger notary address for Google, and the wire decoder
   requires null for Google or an address for every other platform. Remove those
   branches: Client passes its ledger-selected address uniformly, the wire accepts
   a canonical address or null, and only a platform using notarization requires
   an address. Update Client/codec tests; unused addresses open no notary session.

## Authenticated-origin handoff

Callback forwards `connection.peerOrigin` in the private `applicationOrigin`
fragment field. It obtains the value only after popup authentication, never from
OAuth parameters or deployment allowlist order. Prover validates the canonical
origin and supplies `[applicationOrigin]` to popup acceptance. Missing/invalid
origin input fails locally before acceptance; a different authenticated peer
fails before readiness, including through port preservation or isolation fallback.

This implements spec PR #13's exact-origin handoff at
`f2959118357a227885042b8d1e42c5e44bb38cd5` and depends on popup's
ConnectionVersion 2 origin metadata in PR #25. Application, Callback, Prover,
and the root Worker must use that transport version together. Popup owns the
binding and its preservation; ceremony adds no handshake or transport records.
The fixed Callback/Bridge migration above remains separate.

The origin update passed 108 popup unit tests, 426 ceremony unit tests, and
package/build/browser type checks. Fifteen focused popup browser cases passed
in Chromium, Firefox, and WebKit. Twenty-four ceremony browser cases passed
across desktop HTTP/HTTPS and mobile-emulation profiles, including actual
Callback navigation and rejection of a changed origin in the same opener window.
This does not qualify real WebRTC, new live OAuth flows, or physical devices.

## Evidence obtained

The latest coordinated event/client run (2026-09-12) passed 403 unit tests,
17 distribution/native-loader/SWS checks, package and harness TypeScript,
declaration emission, the development frontend build, and workspace style checks.
All 75 development browser cases passed, including mobile emulation.
The six desktop HTTP/HTTPS profiles exercised 72 ceremony cases: 60 passed
initially; after correcting UI/error-text migration failures, all 30 targeted
rechecks passed. This is not a claim that the complete 72-case suite was rerun.

Those checks include one terminal update, readiness without subscribers,
opaque failure context, preserved occurrence timestamps, repeated navigation,
and X orchestration without premature proof delivery. Every generated Google
fixture proof was independently verified against the released key, including
mutated-public-input rejection.

Additional evidence with these component releases:

- Actual isolated browser proof workers generated Google and bearer-link fixture
  proofs. This exercises runtime/key compatibility, not live consent or the
  harness operation's authorization. Google JWKS/time/return inputs are controlled;
  WebKit supplies the public fixture JWKS at the page fetch boundary, so that
  case does not qualify live JWKS CORS.
- Twelve RC3 TLSNotary cases passed on Chromium 151.0.7922.34, Firefox 153.0,
  and WebKit 26.5: one and two concurrent sessions for both `localhost` and
  `127.0.0.1`, on custom ports, alongside real proof-backend initialization.
  Each used actual WASM, HTTPS traffic to `api.x.com`, and final canonical
  attestation delivery over the same reclaimed WebSocket. The requests were
  unauthenticated and ran under the COOP/COEP response. This qualifies that
  transport/runtime probe, not an X identity or live OAuth profile.
- Actual worker-handler tests reject returned transcripts one byte above
  4 KiB sent / 32 KiB received before exposing them to parsing/reveal, even
  when the SDK ignores setup bounds. Missing final EOF reaches the separate
  finalization deadline. These adapter checks do not cap reception memory.
- Native dependency-loader tests observe ACVM/ABI WASM, bb.js WASM, and CRS
  primary/fallback URLs, ranges, cache modes, and ordering. Synthetic CRS bodies
  in those probes are not proof evidence. Distribution tests exercise native
  SWS, Brotli/gzip decoding, actual policies, and retained immutable responses.
- Browser regressions cover real popup/anchor paths, denial, Application
  continuation, and a stale narrower Worker registration using the same script
  URL. Prover joins delayed root-worker prefetch without another server download.
- The pinned Bridge passed 124 tests, Clippy, and its release container build.
  The container fetched Callback and served config accepted by Client. A real
  RC3-notarized GitHub request correctly classified an intentionally invalid code;
  malformed redirects and private-notary egress probes rejected. This is not
  successful confidential exchange or authenticated identity evidence.
- The local HTTP stack admitted the real development registrations; the GitHub
  HTTP callback registration check succeeded after its configuration update.
  One reported manual Firefox GitHub flow completed after the JSON-whitespace
  parser fix. Neither observation qualifies the updated released Ledger Verifier.

Desktop/emulated-mobile checks do not replace physical devices. An intermittent
WebKit multi-popup timeout passed subsequent unchanged retries; that is not
evidence of a diagnosed production fix. Old public-notary setup stalls do not
negate the successful matched local RC3 probes or establish current public-service
availability.

## Remaining qualification

- Fresh approval and denial for every platform against the selected public
  services, including real X token/identity correlation and GitHub's confidential
  token plus browser identity attestations.
- Real notarization under the primary DIP response, public WSS/mobile networks,
  iOS/Android physical devices, Vanadium/JIT behavior, background suspension,
  native platform apps, eviction, and optional opener-independent carriers.
  No WebRTC implementation is supplied by ceremony.
- X request receipt within its authorization-code deadline. The pinned SDK does
  not expose request-direction-only completion, and the browser has no specified
  issuance anchor. A timeout around response completion would reject valid later
  responses and is not a substitute. LIBID-BROWSER-010 remains unresolved.
- Updated released-verifier acceptance of the #31 request framing and
  order-independent/JSON-whitespace rules. Browser parsing tests and matched
  Rust pins alone do not establish ledger acceptance.
- Production Bridge conditional artifact refresh, compressed-source handling,
  redirect rejection, atomic last-good replacement, ingress log redaction, and
  request-selected notary DNS/egress policy. The browser harness's startup
  artifact preparation does not implement that production lifecycle.
- Readable live CRS primary/fallback CORS and Range responses under both isolation
  profiles. External CDN availability is not atomic with a local release.
- Negative real-proof SRS-floor tests and the complete cache/update fault matrix.
  Build-time circuit statistics check 42,006 and 179,443 gates; that is not a
  replacement for runtime capacity qualification.
- Production ledger identifiers and Chain Profile vectors. Tests and the dev app
  import explicit synthetic `LedgerId` fixtures; Client snapshots their hash and
  notary address. Prover contains no ledger decoder or build alias.
- Complete resource/cache accounting, telemetry export, and the
  identity-credential-wait extension. The unified event feed exists; missing
  measurements are not synthesized as zeros.

## Implementation choices

These are local implementation decisions, not alternative protocol rules:

- The source asset API uses positional `archive(source, mount)` and
  `file(source, mount, headers)`. Archive parsing uses the build-only `tar`
  dependency without extracting to archive-selected filesystem paths.
- SWS owns validators, conditional responses, ranges, transfer framing, and
  encoded representation selection. Exact generated header rules account for
  its basename matching. Chunked responses are checked by actual bytes and any
  supplied length, not a forced Content-Length.
- Immutable execution paths include response-policy digests; compatible rebuilds
  retain old assets and their headers. Deployments preserve the accumulated
  artifact for the compatibility window.
- Root registration is selected explicitly. The known narrower registration is
  retired only if all its workers use the canonical script URL; unrelated
  registrations remain untouched. Firefox's root-worker claim precedes readiness.
- Execution workers carry COEP. Build-owned AST edges expose nested workers;
  unused embedded bb.js default-WASM modules resolve to the owned WASM to avoid
  duplicate bundles. Native CRS requests remain untouched.
- The final notary frame/EOF deadline is 30 seconds, separate from proving and X's
  code deadline. It prevents an incomplete frame from retaining a worker forever.
- UI stages are a sequential projection over events; the native progress bar is
  indeterminate. Missing `authorization.finished` can advance presentation at
  Prover readiness without inventing its timestamp.

## Repeatable opt-in real consent

Use the [shared development app](../../../apps/dev/README.md) or a dedicated test
Application, the emitted distribution, a compatible Bridge, and real platform
registrations. Keep confidential credentials in the Bridge's secret store,
not command arguments, reports, or chat.

```sh
CEREMONY_WALKTHROUGH_URL=https://your-test-application.example \
CEREMONY_BROWSER=chromium \
  node ts/qualification/ceremony/walkthrough.mjs
```

The headed runner uses no OAuth mocks and pauses for manual consent and
foreground/suspension/outcome checkpoints. Its ignored report contains only
checkpoint labels, browser version, and optional per-run statuses from the
Application's `window.results` Map; these are outcomes, not cryptographic
verification. Repeat approved/denied, signed-in/out, and native-app installed/absent
cases. Never bypass CAPTCHA, MFA, or platform consent.

For transport diagnosis, run the existing smoke server and
`ts/qualification/ceremony/run-smoke.mjs <browser> <google|bearer|notary|notary-single> [page-url] [notary-origin]`
with the same emitted assets. Repeat both loopback hostnames and engines.
Unauthenticated notary probes record lengths/correlation only; they cannot
replace platform qualification. On physical devices, record the model,
OS/browser version, effective thread counts, and nonsecret outcomes.
No raw OAuth return, credential, witness, transcript, opening, or live proof is
a qualification artifact.

## Popup operation progress (2026-09-13)

The popup bar counts completed operations with UI-owned weights. Duplicate/parent
events add no work, late attestations still advance the bar, and 100% does not
claim Application acceptance. Before delivery, Prover gives the full bar a paint
opportunity using two animation-frame callbacks and a 100 ms timer fallback.
Already-hidden documents skip that wait. Cancellation during the wait prevents
delivery; UI failure cannot suppress it. There is no activity shimmer or app-side
close delay.

Initial restoration passed 410 unit tests, all 17 distribution checks, 24 desktop
browser cases over HTTP/HTTPS and two mobile-emulation UI cases. The desktop run
included real Google fixture proofs independently verified against the released
key in Chromium, Firefox and WebKit.

The final paint behavior was rechecked with 12 focused unit tests, 10 popup UI
cases across all three engines and both mobile-emulation profiles, and 12 app
cases across the desktop engines. These check cancellation while waiting, failed
rendering, hidden/stopped frames, immediate app closure without an app timer, and
unchanged terminal timing records. Package/build/browser/app types and formatting
pass. No new live-notary or physical-device qualification is claimed.
