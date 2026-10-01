# Qualification status

**Release qualification is incomplete.** [Testing](testing.md) provides runnable
commands and manual checkpoints. The [test index](test-plan.md) and
[traceability](traceability.md) retain all 155 stable requirement IDs and identify
untested properties separately from passing assertions.

## Pinned integration

Each pin lives in its declaration; change it there.

| Input | Version | Declared in |
|---|---|---|
| Circuits | v0.5.0 | [bearerLink.assets.ts](../src/barretenberg/circuits/bearer-link/bearerLink.assets.ts), [oidc_google.assets.ts](../src/barretenberg/circuits/oidc_google/oidc_google.assets.ts) |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0 | [package.json](../package.json); EVM proof settings in [parameters.ts](../src/barretenberg/parameters.ts) |
| Notary browser/runtime | v0.4.0, with the TLSN and MPZ revisions of that release | [notary.assets.ts](../src/notary/notary.assets.ts), [test services](../e2e/compose.yaml) |
| Development Bridge | v0.5.0, one OAuth client per platform and no version list | [compose.yaml](../../../apps/dev/compose.yaml) |
| SWS | 3.0.0-beta.1 | [ccdp.Dockerfile](../ccdp.Dockerfile) |

Bridge v0.5.0 supports exact and wildcard admission. Browser tests cover both
wildcard forms in Popup and `*` through the emitted Callback handoff; Callback
units cover pattern forwarding.

The released `bearer_link` circuit accepts bearers of at most 128 bytes. The
X and GitHub specifications allow up to 4096 bytes; both implementations enforce
the circuit's narrower limit on the token response, where they also reject the
whitespace an HTTP bearer cannot carry. The released `oidc_google` circuit
accepts a Google `sub` of at most 31 bytes, an email of at most 62 bytes and an
audience of at most 128 bytes, all printable ASCII without `"`; Google's
specification allows a `sub` of up to 255 bytes. A token outside those limits
fails at authorization with its own message, before any key fetch or proving.
[Specifications](../README.md#specifications) own proof and protocol requirements;
[platform provers](provers.md) describe this implementation.

## Current coverage

CI runs workspace type/unit checks, distribution/native-loader tests and browser
coverage across Chromium, Firefox and WebKit. HTTP and mobile-emulated projects
retain interaction and policy coverage; full proofs and matched-notary runtime
qualification run per desktop engine. The `@live` runtime tests and the reveal stall
test's setup sends, which run through the real notary against the X and GitHub APIs,
retry once inside the test unless a deadline was missed; nothing else retries. Independent
workspace/engine CI jobs run in parallel; a pull request runs only the workspaces
its changes can affect, and every push to `main` runs them all. Each engine generates the Google,
X and GitHub ceremony proofs plus one real-notary coexistence proof. A configured
test is not evidence that the current revision passed it.

| Coverage | What it establishes / limit |
|---|---|
| Unit and type checks | Client lifecycle, exact codecs, canonical vectors, parsers, concurrency ordering and public types; the bearer prover tests retain real selectors/correlation/circuit input construction while mocking external runtimes; they do not establish real proving or live-service behavior. |
| Distribution/native-loader/SWS checks | Emitted policies, compression/ranges, immutable URLs and actual loader requests, including the running image and pinned native binary in CI. Live CDN availability is separate; local runs need the [explicit inputs](testing.md#distribution-checks). |
| Actual-popup browser flows | Private Callback handoff, exact Application origin, readiness, denial/failure, concurrency, root Worker control and progress across desktop engines and emulation. |
| Google and bearer-link fixture proofs | Actual isolated browser workers generate proofs verified in Node against released keys, including altered-public-input rejection. Controlled Google token/time/JWKS inputs do not establish live consent or JWKS CORS; every engine substitutes the fixture JWKS at the page boundary, because WebKit's page fetch bypasses Playwright routing. |
| X/GitHub browser ceremony fixtures | Actual emitted Callback/Prover, Popup connection, session worker and Client execute success and changed-final-attestation rejection. Real bearer-link proofs verify against commitments extracted from delivered fixture attestations and the released key; digest/PKCE matches the frozen request. OAuth and the TLSN SDK/peer are substituted, and notary signatures are synthetic. This does not qualify real TLSN or authenticated provider evidence. |
| Real matched-notary runtime tests | One/two X sessions and both GitHub endpoints run through the pinned notary in direct peer mode. The GitHub pair runs alongside a separately verified fixture proof and asserts real shared-memory proving with multiple threads. Unauthenticated requests and deliberately invalid credentials establish runtime/channel execution and authority correlation, not authenticated token/identity evidence. The separate fixture proof is not bound to these attestations. |
| Development app checks | Independent concurrent rows, closure, timings, fallback display and immediate success/denial closure, using intercepted responses. |
| Bridge integration checks | Public configuration/credential forwarding, origin admission, response headers, Callback insertion and simulated Google/GitHub denial round trips through the e2e Bridge stand-in ([server.mjs](../e2e/server.mjs), which serves the record) and emitted CCDP, whose `versions.json` the client reads; no released Bridge image runs in these tests. Provider returns are intercepted; live success and verifier acceptance are listed under remaining qualification. Production refresh behavior remains a separate gate. |

## Remaining qualification

- Recorded live success and verifier acceptance. Manual wallet PoC runs reported
  live Google, X and GitHub completion on desktop and mobile and real verifier
  acceptance for all three, without recording the revision, CCDP image digest,
  Bridge and notary versions, browser and device, verifier contract and chain,
  or date; a qualifying run records each of them.
- Live denial and interruption paths for each platform.
- The full physical iOS/Android matrix:
  Vanadium/JIT behavior, app-installed/absent handoff,
  background suspension, memory pressure, eviction, public WSS/mobile networks
  and primary DIP notarization. Emulation cannot establish these properties.
- Optional opener-independent carrier/signaling and real openerless returns.
  Ceremony supplies the integration point, not a WebRTC implementation.
- Full verifier conformance coverage for header/framing and JSON-whitespace
  variants beyond the responses exercised by successful live runs.
- Production Bridge conditional/compressed Callback refresh, redirect rejection,
  atomic last-good replacement and ingress log redaction. The browser harness does not implement that lifecycle.
- Live CRS primary/fallback availability, readable CORS and Range under both
  isolation policies; complete cold/partial/warm/update/restart/quota fault coverage.
- Negative real-proof SRS-floor tests. Build-time gate/capacity checks do not
  establish runtime capacity qualification.
- Production ledger definitions and Chain Profile vectors. Tests use synthetic
  `LedgerId` fixtures and supply no ledger decoder in Prover.
- Complete request/download/joiner accounting, identity-credential-wait extension
  and telemetry export. Missing measurements are not synthesized as zero.

Keep this status and the affected traceability rows aligned with verification
results; keep individual run logs out of package documentation.
