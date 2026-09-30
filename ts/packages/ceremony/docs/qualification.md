# Qualification status

**Release qualification is incomplete.** [Testing](testing.md) provides runnable
commands and manual checkpoints. The [test index](test-plan.md) and
[traceability](traceability.md) retain all 159 stable requirement IDs and identify
untested properties separately from passing assertions.

## Pinned integration

Change dependency pins in the linked declarations and configuration.

| Input | Version / owner |
|---|---|
| Circuits | v0.4.0, `b618e41eaf8bd0ec5f6e74b3efc2480dbec7e00a`; [circuit declarations](../src/barretenberg/circuits/). |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0; [package.json](../package.json), explicit EVM proof settings in [parameters.ts](../src/barretenberg/parameters.ts). |
| Notary browser/runtime | v0.4.0, `829d8eb8778d4f1c30a2ec1f4c7cbd55e47d318a`; [declaration](../src/notary/notary.assets.ts), [test services](../e2e/compose.yaml). |
| TLSN / MPZ | `da0f8488dfc55db8ed4271f817124306a2c07c09` / `4db9454a0b6380f1a23a7b4807989d866f838fff`, matched by the notary release. |
| Development Bridge | v0.5.0, `63c9bfe7036ec9f16af19420254a9873aaae02a2`; [Compose pin](../../../apps/dev/compose.yaml). Publishes one OAuth client per platform and no version list. |
| SWS | 3.0.0-beta.1; exact image digest in [ccdp.Dockerfile](../ccdp.Dockerfile). |

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
qualification run per desktop engine. All runtime tests, which run through the
real notary against the X and GitHub APIs, retry once; nothing else retries. Independent
workspace/engine CI jobs run in parallel. Each engine generates the Google,
X and GitHub ceremony proofs plus one real-notary coexistence proof. A configured
test is not evidence that the current revision passed it.

Manual wallet PoC testing reports
successful live Google, X and GitHub ceremony completion on desktop and mobile
using the current ceremony package. Manual end-to-end runs also establish real
verifier acceptance for all three platforms. Exact browser/device and verifier
versions are not recorded.

| Coverage | What it establishes / limit |
|---|---|
| Unit and type checks | Client lifecycle, exact codecs, canonical vectors, parsers, concurrency ordering and public types; the bearer prover tests retain real selectors/correlation/circuit input construction while mocking external runtimes; they do not establish real proving or live-service behavior. |
| Distribution/native-loader/SWS checks | Emitted policies, compression/ranges, immutable retention and actual loader requests, including the running image and pinned native binary in CI. Live CDN availability is separate; local runs need the [explicit inputs](testing.md#distribution-checks). |
| Actual-popup browser flows | Private Callback handoff, exact Application origin, readiness, denial/failure, concurrency, root Worker control and progress across desktop engines and emulation. |
| Google and bearer-link fixture proofs | Actual isolated browser workers generate proofs verified in Node against released keys, including altered-public-input rejection. Controlled Google token/time/JWKS inputs do not establish live consent or JWKS CORS; every engine substitutes the fixture JWKS at the page boundary, because WebKit's page fetch bypasses Playwright routing. |
| X/GitHub browser ceremony fixtures | Actual emitted Callback/Prover, Popup connection, session worker and Client execute success and changed-final-attestation rejection. Real bearer-link proofs verify against commitments extracted from delivered fixture attestations and the released key; digest/PKCE matches the frozen request. OAuth and the TLSN SDK/peer are substituted, and notary signatures are synthetic. This does not qualify real TLSN or authenticated provider evidence. |
| Real matched-notary runtime tests | One/two X sessions and both GitHub endpoints run through the pinned notary in direct peer mode. The GitHub pair runs alongside a separately verified fixture proof and asserts real shared-memory proving with multiple threads. Unauthenticated requests and deliberately invalid credentials establish runtime/channel execution and authority correlation, not authenticated token/identity evidence. The separate fixture proof is not bound to these attestations. |
| Development app checks | Independent concurrent rows, closure, timings, fallback display and immediate success/denial closure, using intercepted responses. |
| Bridge integration checks | Public configuration/credential forwarding, origin admission, response headers, Callback insertion and simulated Google/GitHub denial round trips through the e2e Bridge stand-in ([server.mjs](../e2e/server.mjs), which serves the record) and emitted CCDP, whose `versions.json` the client reads; no released Bridge image runs in these tests. Provider returns are intercepted; manual live success and verifier acceptance are described above. Production refresh behavior remains a separate gate. |

## Remaining qualification

- Live denial and interruption paths for each platform.
- The full physical iOS/Android matrix beyond successful mobile completion:
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
