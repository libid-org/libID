# Qualification status

**Release qualification is incomplete.** Runnable commands belong in
[Testing](testing.md); all 158 stable requirement IDs remain in the
[test index](test-plan.md) and [traceability](traceability.md). A partial row
retains its untested property even when related tests pass.

## Pinned integration

These are the current integration pins, not a second configuration source. Change
actual pins in the linked declarations/configuration. Historical evidence below
retains the release and implementation versions that it exercised.

| Input | Evidence baseline / owner |
|---|---|
| Browser specification | PR #13, `374035cf922665507163b07cf81e98afeaf2188b`; [CCDP](https://github.com/libid-org/libid/blob/374035cf922665507163b07cf81e98afeaf2188b/specs/ccdp.md). |
| Circuits | v0.4.0, `b618e41eaf8bd0ec5f6e74b3efc2480dbec7e00a`; [circuit declarations](../src/barretenberg/circuits/). |
| Noir / bb.js | 1.0.0-beta.25 / 5.2.0; [package.json](../package.json), explicit EVM proof settings in [engine.worker.ts](../src/barretenberg/engine.worker.ts). |
| Notary browser/runtime | v0.4.0, `829d8eb8778d4f1c30a2ec1f4c7cbd55e47d318a`; [declaration](../src/notary/notary.assets.ts), [test services](../e2e/compose.yaml). |
| TLSN / MPZ | `da0f8488dfc55db8ed4271f817124306a2c07c09` / `4db9454a0b6380f1a23a7b4807989d866f838fff`, matched by the notary release. |
| Development Bridge | `ea8121f4e05c39a0b383ecb383e2625feb088c91` (PR #8), standalone HTTP Bridge without libid-rs or TLSNotary dependencies; [Compose pin](../../../apps/dev/compose.yaml). |
| SWS | 3.0.0-beta.1; exact image digest in [ccdp.Dockerfile](../ccdp.Dockerfile). |
| HTTP framing | Spec PR #31, `5afdf08`; [platform rules](https://github.com/libid-org/libid/blob/5afdf08/specs/platform-ceremonies.md). |

The GitHub browser exchange follows PR #35 at
[`5e0e1f690369a7e4c5b61634342ae7fdb975795e`](https://github.com/libid-org/libid/blob/5e0e1f690369a7e4c5b61634342ae7fdb975795e/specs/platform-ceremonies.md).
It changes the token request's disclosure layout, not the bearer-link circuit.
The released circuit still bounds bearers to 128 bytes; the profile's broader
4096-byte limit is not evidence that this pinned circuit can accept them.

## Contract alignment

The client derives fixed `/auth/callback` from the supplied Bridge origin; the
public configuration contains no callback path or redirect URI. Bridge supplies
GitHub's public `clientCredential`, which Client freezes and forwards unchanged.
Prover exchanges GitHub tokens directly through the selected notary. Live consent
with this updated Bridge and matched PlatformVerifier acceptance still require
separate qualification.

The current event/outcome catalog, authenticated-origin handoff and uniform notary
input forwarding are implemented. They are not pending migrations. Popup owns
transport compatibility; ceremony consumes `@libid/popup`.

## Evidence obtained

The 2026-09-22 bump exercised the matched notary/WASM 0.4.0 release in direct
peer mode, without a reverse proxy. All 465 unit tests, 19 distribution checks
(two unchanged native-binary skips), and 18 browser checks passed across Chromium,
Firefox and WebKit, including concurrent X/GitHub notarization alongside
released-key-verified proofs. Six additional local probes delayed request dispatch
by 25 seconds after preparing two X/GitHub sessions: both attestations completed
in every browser/platform case. Live OAuth consent and physical devices were not rerun.

The 2026-09-21 release bump exercised notary 0.3.1 and circuits 0.4.0:
465 final unit tests and 19 distribution/loader/served-header checks passed
(two unchanged native-binary checks were not selected). Across Chromium,
Firefox and WebKit, 18 browser checks covered released-key-verified Google and
bearer-link proofs, mounted WASM initialization and matched notary concurrency;
after the idle-socket startup adjustment, all nine affected notary/proof cases
passed again. Circuit JSON and verification keys are byte-identical to 0.3.0;
the added Solidity files are not mounted. Live consent and ARM execution were
not rerun.

At implementation commit `0a3b14d` (2026-09-15), the
[hosted GitHub Actions run](https://github.com/libid-org/libid/actions/runs/35000802410)
passed TypeScript, Browser tests, CCDP image/distribution and DCO checks. The browser job passed **140 ceremony, 143 popup and 145 dev-app
cases**, with two existing popup feature skips and no retries. The ceremony
suite runs Chromium, Firefox, WebKit, HTTP/HTTPS document flows and mobile
emulation. This supersedes the earlier failing hosted run; it does not establish
live-service or physical-device qualification.

| Evidence | What it establishes / limit |
|---|---|
| Unit and type checks | Client lifecycle, exact codecs, canonical vectors, parsers, concurrency ordering and public types; no proof or live-service authority from mocks. |
| Distribution/native-loader/SWS checks | Emitted policies, compression/ranges, immutable retention and actual loader requests; live CDN availability is separate. Conditional native-server checks require the [explicit inputs](testing.md#distribution-checks). |
| Actual-popup browser flows | Private Callback handoff, exact Application origin, readiness, denial/failure, concurrency, root Worker control and progress across desktop engines and emulation. |
| Google and bearer-link fixture proofs | Actual isolated browser workers generate proofs verified in Node against released keys, including altered-public-input rejection. Controlled Google token/time/JWKS inputs do not establish live consent or JWKS CORS; WebKit intercepts fixture JWKS at the page boundary. |
| Real matched-notary runtime tests | One/two concurrent matched notary sessions alongside a separately verified fixture proof. The new two-endpoint GitHub probe passed in Chromium, Firefox and WebKit using deliberately invalid credentials. X/GitHub probes establish runtime/channel execution and authority correlation, not a successful token exchange or authenticated identity. Earlier RC3 probes also covered localhost and 127.0.0.1. |
| Development app checks | Independent concurrent rows, closure, timings, fallback display and immediate success/denial closure. These use intercepted responses. |
| Bridge integration checks | The pinned standalone Bridge image built successfully. Against the running container, public configuration/credential forwarding, origin admission, response headers, fixed Callback insertion, and removal of the old routes passed. Six Google/GitHub simulated-denial round trips passed through the actual Bridge and emitted CCDP in Chromium, Firefox and WebKit. Only provider returns were intercepted; these checks establish neither live consent nor proof verification. |
| Reported manual use | The developer reported successful manual runs with the updated Bridge and browser GitHub exchange. These observations do not replace a repeatable released-verifier/device qualification record. |

## Remaining qualification

- Repeat hosted Firefox qualification with the matched 0.4.0 server/WASM pair.
  It includes the deferred target connection and early-EOF fixes, but passing
  local runtime probes cannot establish that every intermittent CI stall is fixed.
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
- Released-verifier acceptance of the updated header/framing and JSON-whitespace
  rules with real platform evidence. Matching Rust/browser parsers alone is insufficient.
- Production Bridge conditional/compressed Callback refresh, redirect rejection,
  atomic last-good replacement and ingress log redaction. The browser harness does not implement that lifecycle.
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
