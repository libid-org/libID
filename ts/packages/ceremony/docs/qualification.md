# Qualification status

**Release qualification is incomplete.** Runnable commands belong in
[Testing](testing.md); all 158 stable requirement IDs remain in the
[test index](test-plan.md) and [traceability](traceability.md). A partial row
retains its untested property even when related tests pass.

## Pinned integration

These are the component revisions used for the recorded evidence, not a second
configuration source. Change actual pins in the linked declarations/configuration.

| Input | Evidence baseline / owner |
|---|---|
| Browser specification | PR #13, `5b46008f632656fd0ecffecd0cb32fdbbf7a05b4`; [CCDP](https://github.com/libid-org/libid/blob/5b46008f632656fd0ecffecd0cb32fdbbf7a05b4/specs/ccdp.md). |
| Circuits | v0.3.0, `91bc3446eeaa50ab2056d88dd9941374aa4fa34c`; [circuit declarations](../src/barretenberg/circuits/). |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0; [package.json](../package.json), explicit EVM proof settings in [engine.worker.ts](../src/barretenberg/engine.worker.ts). |
| Notary browser/runtime | v0.3.0-rc.3, `37e195035e6b11683b09233a8815ae703e3cc55f`; [declaration](../src/notary/notary.assets.ts), [test services](../e2e/compose.yaml). |
| TLSN / MPZ | `94aaaf33f3361d1218f9abb4c82b5c58a9199460` / `1dd2349d52aeea038d77fb0816f781c6b714fe77`, matched by the notary/Bridge releases. |
| Development Bridge | `cdc16551114070ea3458ef0d5ceb19ca4228833e`, based on `991d5c604acdb1a67099f28cbf37ad58b6c317a5`, using libid-rs v0.4.0 (`82bc4e286d762531ba3ac86996db4afc6ea38f56`); [Compose pin](../../../apps/dev/compose.yaml). |
| SWS | 3.0.0-beta.1; exact image digest in [ccdp.Dockerfile](../ccdp.Dockerfile). |
| HTTP framing | Spec PR #31, `860075a4bf288dc7fee20866ed3536dc260f4574`; [platform rules](https://github.com/libid-org/libid/blob/860075a4bf288dc7fee20866ed3536dc260f4574/specs/platform-ceremonies.md). |

## Pending contract updates

The fixed Callback path migration remains coordinated with Bridge. Current
configuration contains `callbackPath`; Client freezes the resulting redirect URI
and GitHub includes `redirectUri` in its token request and admission checks.
The specification fixes `/auth/callback` and removes both wire fields. Update
Client, codecs, tests and deployed Bridge together; this cleanup does not claim
that migration is implemented.

The current event/outcome catalog, authenticated-origin handoff and uniform notary
input forwarding are implemented. They are not pending migrations. Popup owns
transport compatibility; ceremony is based on the merged popup implementation.

## Evidence obtained

At implementation commit `79790d9` (2026-09-13), the complete package browser
command passed locally: **127 Playwright cases, no skips**, across Chromium,
Firefox, WebKit, HTTP/HTTPS document flows and mobile emulation. The separate
Ceremony e2e CI job runs that same command. The first
[hosted run](https://github.com/libid-org/libid/actions/runs/34779236470) passed 125
cases and failed two Firefox cases: Google fixture proof delivery exceeded its
420-second wait, and the two-session notary probe timed out. Those failures remain
unresolved; the local pass is not evidence of CI stability.

| Evidence | What it establishes / limit |
|---|---|
| Unit and type checks | Client lifecycle, exact codecs, canonical vectors, parsers, concurrency ordering and public types; no proof or live-service authority from mocks. |
| Distribution/native-loader/SWS checks | Emitted policies, compression/ranges, immutable retention and actual loader requests; live CDN availability is separate. Conditional native-server checks require the [explicit inputs](testing.md#distribution-checks). |
| Actual-popup browser flows | Private Callback handoff, exact Application origin, readiness, denial/failure, concurrency, root Worker control and progress across desktop engines and emulation. |
| Google and bearer-link fixture proofs | Actual isolated browser workers generate proofs verified in Node against released keys, including altered-public-input rejection. Controlled Google token/time/JWKS inputs do not establish live consent or JWKS CORS; WebKit intercepts fixture JWKS at the page boundary. |
| Real matched-notary runtime tests | One/two concurrent RC3 sessions alongside a separately verified fixture proof. Unauthenticated X requests establish runtime/channel execution, not token/identity correlation or authenticated OAuth. Earlier RC3 probes also covered localhost and 127.0.0.1. |
| Development app checks | Independent concurrent rows, closure, timings, fallback display and immediate success/denial closure. These use intercepted responses. |
| Bridge integration checks | The pinned Bridge previously passed 124 tests, Clippy and its container build; Callback/config retrieval and invalid-code/egress rejection probes passed. This is not successful confidential exchange qualification. |
| Reported manual use | Local provider registrations and a Firefox GitHub flow after the whitespace fix were exercised. These observations are not a repeatable released-verifier/device qualification record. |

An earlier intermittent WebKit multi-popup timeout passed unchanged retries; its
cause was not diagnosed. Later complete-suite success does not establish a fix
for that earlier observation.

## Remaining qualification

- Diagnose the hosted Firefox proof-delivery and concurrent-notary timeouts above.
- Real approval and denial for every platform against the selected deployed
  services, including X token/identity correlation and GitHub's confidential
  token plus browser identity attestations, followed by released-verifier acceptance.
- Physical iOS/Android devices, Vanadium/JIT behavior, app-installed/absent handoff,
  background suspension, memory pressure, eviction, public WSS/mobile networks
  and primary DIP notarization. Emulation cannot establish these properties.
- Optional opener-independent carrier/signaling and real openerless returns.
  Ceremony supplies the integration point, not a WebRTC implementation.
- **LIBID-BROWSER-010:** X's request-direction deadline has no observable issuance
  anchor or request-direction-only completion contract in the pinned SDK.
  A response-completion timeout would reject valid responses and cannot substitute.
- Released-verifier acceptance of the updated header/framing and JSON-whitespace
  rules with real platform evidence. Matching Rust/browser parsers alone is insufficient.
- Production Bridge conditional/compressed Callback refresh, redirect rejection,
  atomic last-good replacement, ingress log redaction and request-selected
  notary DNS/egress policy. The browser harness does not implement that lifecycle.
- Live CRS primary/fallback availability, readable CORS and Range under both
  isolation policies; complete cold/partial/warm/update/restart/quota fault coverage.
- Negative real-proof SRS-floor tests. Build-time gate/capacity checks do not
  establish runtime capacity qualification.
- Production ledger definitions and Chain Profile vectors. Tests currently use
  synthetic `LedgerId` fixtures and supply no ledger decoder in Prover.
- Complete request/download/joiner accounting, identity-credential-wait extension
  and telemetry export. Missing measurements are not synthesized as zero.

Use the [manual checkpoints](testing.md#manual-consent-and-device-checks) to collect
new evidence. Update this baseline and the affected traceability rows together;
keep individual run logs out of package documentation.
