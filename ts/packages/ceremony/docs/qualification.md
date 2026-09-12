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
The two implementation differences below are explicit, not competing contracts.

## Pending contract updates

1. **Fixed Callback path — coordinated Bridge migration deferred.**
   Current config contains `callbackPath`; Client resolves it against the Bridge
   origin and GitHub's token request includes the frozen `redirectUri`.
   The spec fixes `/auth/callback`, removes `callbackPath` from config, and
   removes `redirectUri` from that token request. Client, CCDP, tests, and the
   separately deployed Bridge need a coordinated change. This docs-only
   reconciliation does not implement it.
2. **Carry Callback's authenticated Application origin to Prover.**
   Current Callback authenticates its explicit allowlist, but Prover accepts
   `'*'`. The spec requires a private `applicationOrigin` fragment field derived
   from Callback's authenticated peer and exact admission at Prover, including
   fallback/replacement. This needs authenticated-peer-origin access from popup
   and a coordinated navigation-codec/document/test update. Do not claim the
   restriction is implemented or that a retained window reference establishes it.

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
checkpoint labels, browser version, and optional result status, not verification
claims. Repeat approved/denied, signed-in/out, and native-app installed/absent
cases. Never bypass CAPTCHA, MFA, or platform consent.

For transport diagnosis, run the existing smoke server and
`ts/qualification/ceremony/run-smoke.mjs <browser> <google|bearer|notary|notary-single> [page-url] [notary-origin]`
with the same emitted assets. Repeat both loopback hostnames and engines.
Unauthenticated notary probes record lengths/correlation only; they cannot
replace platform qualification. On physical devices, record the model,
OS/browser version, effective thread counts, and nonsecret outcomes.
No raw OAuth return, credential, witness, transcript, opening, or live proof is
a qualification artifact.
