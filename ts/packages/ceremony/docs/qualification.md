# Qualification status

**Release qualification is incomplete.** [Testing](testing.md) provides runnable
commands and manual checkpoints. The [test index](test-plan.md) and
[traceability](traceability.md) retain all 158 stable requirement IDs and identify
untested properties separately from passing assertions.

## Pinned integration

Change dependency pins in the linked declarations and configuration.

| Input | Version / owner |
|---|---|
| Circuits | v0.4.0, `b618e41eaf8bd0ec5f6e74b3efc2480dbec7e00a`; [circuit declarations](../src/barretenberg/circuits/). |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0; [package.json](../package.json), explicit EVM proof settings in [engine.worker.ts](../src/barretenberg/engine.worker.ts). |
| Notary browser/runtime | v0.4.0, `829d8eb8778d4f1c30a2ec1f4c7cbd55e47d318a`; [declaration](../src/notary/notary.assets.ts), [test services](../e2e/compose.yaml). |
| TLSN / MPZ | `da0f8488dfc55db8ed4271f817124306a2c07c09` / `4db9454a0b6380f1a23a7b4807989d866f838fff`, matched by the notary release. |
| Development Bridge | `ea8121f4e05c39a0b383ecb383e2625feb088c91`; [Compose pin](../../../apps/dev/compose.yaml). |
| SWS | 3.0.0-beta.1; exact image digest in [ccdp.Dockerfile](../ccdp.Dockerfile). |

The released `bearer_link` circuit accepts bearers of at most 128 bytes. The
platform profile's 4096-byte bound does not expand this circuit limit.
[Specifications](../README.md#specifications) own proof and protocol requirements;
[platform pipelines](pipelines.md) describe this implementation.

## Current coverage

[CI](https://github.com/libid-org/libID/actions/runs/35717662579) is green for
TypeScript, browser tests, CCDP image/distribution, integration smoke and DCO.
Browser coverage comprises 140 ceremony, 143 popup and 145 dev-app cases, with
two popup feature skips and no retries. It spans Chromium, Firefox, WebKit,
HTTP/HTTPS document flows and mobile emulation. Live consent and physical devices
require separate qualification.

| Coverage | What it establishes / limit |
|---|---|
| Unit and type checks | Client lifecycle, exact codecs, canonical vectors, parsers, concurrency ordering and public types; mocks do not establish real proving or live-service behavior. |
| Distribution/native-loader/SWS checks | Emitted policies, compression/ranges, immutable retention and actual loader requests, including the running image and pinned native binary in CI. Live CDN availability is separate; local runs need the [explicit inputs](testing.md#distribution-checks). |
| Actual-popup browser flows | Private Callback handoff, exact Application origin, readiness, denial/failure, concurrency, root Worker control and progress across desktop engines and emulation. |
| Google and bearer-link fixture proofs | Actual isolated browser workers generate proofs verified in Node against released keys, including altered-public-input rejection. Controlled Google token/time/JWKS inputs do not establish live consent or JWKS CORS; WebKit intercepts fixture JWKS at the page boundary. |
| Real matched-notary runtime tests | One/two X sessions and both GitHub endpoints run through the pinned notary in direct peer mode alongside a separately verified fixture proof. Unauthenticated requests and deliberately invalid credentials establish runtime/channel execution and authority correlation, not authenticated token/identity evidence. The separate fixture proof is not bound to these attestations. |
| Development app checks | Independent concurrent rows, closure, timings, fallback display and immediate success/denial closure, using intercepted responses. |
| Bridge integration checks | Public configuration/credential forwarding, origin admission, response headers, Callback insertion and simulated Google/GitHub denial round trips through the pinned Bridge and emitted CCDP. Provider returns are intercepted; live consent, proof verification and production refresh behavior remain separate gates. |

## Remaining qualification

- Real approval and denial for every platform against the selected deployed
  services, including X/GitHub browser token/identity correlation and GitHub's
  fully disclosed five-field token request, followed by released-verifier acceptance.
- Physical iOS/Android devices, Vanadium/JIT behavior, app-installed/absent handoff,
  background suspension, memory pressure, eviction, public WSS/mobile networks
  and primary DIP notarization. Emulation cannot establish these properties.
- Optional opener-independent carrier/signaling and real openerless returns.
  Ceremony supplies the integration point, not a WebRTC implementation.
- **LIBID-BROWSER-010:** X's request-direction deadline has no observable issuance
  anchor or request-direction-only completion contract in the pinned SDK.
  A response-completion timeout would reject valid responses and cannot substitute.
- Released-verifier acceptance of the header/framing and JSON-whitespace
  rules with real platform evidence. Matching Rust/browser parsers alone is insufficient.
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
