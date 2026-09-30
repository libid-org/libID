# Testing

Use Node 24+, pnpm and the frozen workspace lockfile. All commands below run
from the repository root. [Qualification](qualification.md) records evidence and
release gaps; [traceability](traceability.md) maps the stable
[test requirements](test-plan.md) to assertions and remaining properties.

## Layers

Each layer replaces less than the one before it:

| Layer | Command | Real | Replaced | CI |
|---|---|---|---|---|
| Unit and conformance | `test` | Package logic, validators, transcripts, witnesses | Browser, workers, network, TLSN runtime, proof engine | TypeScript |
| Distribution | `test:distribution` | The emitted artifact, its headers and pins; SWS when supplied | Nothing inside the artifact | CCDP image |
| Browser | `test:e2e` | Browsers, popup, documents, Service Worker, assets, proving and released-key verification; notary in `runtime.spec.ts` | Providers and, outside the runtime suite, the TLSN peer | Browser tests |
| Dev app | `apps/dev` `test:e2e` | The dev UI over the real popup transport | Ceremony documents, OAuth, proofs | Browser tests |
| Manual | [below](#manual-consent-and-device-checks) | Live providers, devices, the ledger verifier | — | — |

Across layers:

- Every test title cites its [test-plan](test-plan.md) ID. A simulated pass is
  labeled as such and never counts as qualification.
- Platform coverage iterates the catalog through typed fixture tables, never a
  literal platform list.
- Expectations are independent of the code under test: pinned external vectors
  (libid-rs attested data, a real Google token with bb.js-produced public inputs,
  released keys) and separately written values, not the production constants.
- Shared test code lives once: connection and browser doubles in
  `@libid/popup/testing`; ceremony values, HTTP, worker, CCDP and platform
  builders in `src/testing`; harness helpers in `e2e/fixtures.ts`.

Where a new test belongs:

- a branch in one module: a unit test beside it;
- a rule every platform must meet: a conformance section and a fixture field,
  so every platform must supply it ([Adding a platform](#adding-a-platform));
- behavior only a browser shows: an e2e spec, iterating `e2e/platforms.ts` when
  it is per platform, and tagged `@proof` when it generates proofs;
- whatever stays simulated or manual: its [traceability](traceability.md) row.

## Unit and type checks

```sh
pnpm -C ts install --frozen-lockfile
pnpm -C ts --filter '@libid/ceremony...' build
pnpm -C ts --filter @libid/ceremony typecheck
pnpm -C ts --filter @libid/ceremony typecheck:e2e
pnpm -C ts --filter @libid/ceremony test
```

Unit tests sit beside their source owners. Canonical fixtures cover authorization,
JWT/circuit inputs and signed attestation decoding. Worker and prover mocks
exercise failures and scheduling; they do not establish real proving or runtime
concurrency. Workspace CI runs build, unit tests, lint and formatting separately
from the browser job.

`pnpm -C ts --filter @libid/ceremony test:coverage` measures production-source
coverage into `coverage/`. On each push to `main`, CI publishes its line
coverage to the `badges` branch for the README badge.

## Adding a platform

The [conformance suite](../src/platforms/conformance/conformance.test.ts) and other
per-platform unit tests iterate `supportedPlatforms` and read one typed
[fixture table](../src/platforms/conformance/fixtures.ts) (through `src/testing`)
instead of naming platforms. A catalog entry without a fixture fails `typecheck`
at that table. The entry supplies:

- the Bridge client (and public credential when `requiresClientCredential`), its
  expected OAuth return rules, a valid identity and proof with the digest it is
  bound to and its expected expiry, boundary and admitted client IDs, and
  platform-specific rejected identity encodings and out-of-bound proof values;
- accepted, denied and provider-error returns for a given OAuth state, the
  prover's weighted operations and its lazily imported `prover.ts`;
- its prover kind and evidence. A bearer-link platform supplies its response
  bodies, transcript module, token endpoint and form, identity endpoint and
  pinned headers. An OIDC platform supplies its signed ID token, JWK and
  minimal JWK, nonce digest and its circuit input, released-verifier public
  inputs, the well-formed changes that break its binding, and the token and key
  rewrites it rejects, each with the operation that rejects it;
- the normative test IDs each conformance section tags for this platform.

The suite then checks catalog members, authorization-URL round-trip, client-ID
and credential rules, weights and assets; the OAuth return matrix (outcomes,
metadata, state, issuer, malformed/oversized/leaked fields and transports); the
generated identity/proof reject matrix, result acceptance and expiry, and OIDC
binding mismatches; and a `prove()` contract every platform meets whatever its
prover kind (delivery, operation reporting, the run's signal and engine teardown,
changed engine public inputs, startup cancellation), followed by each prover
kind's own cases (bearer-link transcripts, results and orchestration; OIDC
binding, evidence and key sets), replacing only the TLSN runtime and proof
engine. A check runs for every platform of a kind only when that kind's shared
code enforces it; anything one platform alone requires comes from its fixture.
A new prover kind adds its evidence shape, a stage for the shared contract
(`typecheck` fails until it exists) and its own cases.

Unit tests beside a platform's source keep only what the suite cannot reach
through `prove()`, such as Google's circuit ABI vectors and the bearer guard in
the bearer-link circuit inputs. Map newly tagged IDs in
[traceability](traceability.md).

## Distribution checks

```sh
pnpm -C ts --filter @libid/ceremony build:ccdp-artifacts
pnpm -C ts --filter @libid/ceremony test:distribution
```

These Node tests exercise archive handling, emitted resources and header rules,
circuit capacity and the installed dependency loaders. **HTTP and native-binary
checks are conditional**: a default run skips them unless their service/binary
inputs are supplied. A green default run is not the complete distribution
qualification; with `CEREMONY_REQUIRE_NATIVE=1`, a missing input fails the run
instead of skipping.

To include served-response checks (exact routes and policies, negotiation,
uncacheable 404s and the `/health` probe), [build and run the emitted SWS image](distribution.md#build-and-serve)
on port 8080, then run:

```sh
CEREMONY_SWS_URL=http://127.0.0.1:8080 \
  pnpm -C ts --filter @libid/ceremony test:distribution
```

For another output directory, set `CEREMONY_ARTIFACT_DIR` to its absolute path and
point SWS at that same artifact. To include the same-length ETag regression and the
[header-matching canary](distribution.md#native-server-behavior), also set
`CEREMONY_SWS_BINARY` to a locally runnable `static-web-server` from the
[pinned release](https://github.com/static-web-server/static-web-server/releases/tag/v3.0.0-beta.1).
Those tests start their own servers on `CEREMONY_SWS_TEST_PORT` (default 4988) and
the next port. These inputs are test-only. The workspace **CCDP image** CI job runs
all of them against the freshly built image and the pinned binary, requiring them
with `CEREMONY_REQUIRE_NATIVE=1`.

## Browser tests

Browser coverage is keyed by the platform catalog: [platforms.ts](../e2e/platforms.ts)
holds one entry per catalog platform, and `typecheck:e2e` fails until a new
platform has one. An entry states the harness Bridge registration, the
authorization endpoint and return transport the popup must reach, the synthetic
evidence its ceremonies run under, and its real-notary session counts.

For every entry, `e2e/platforms.spec.ts` runs a bound denial and complete
ceremony handoffs with accepted and corrupted evidence, using synthetic OAuth
returns. Google uses its signed fixture JWT and fixture JWKS; the corrupted run
changes one signature bit, which witness execution must reject. X/GitHub use a
test-only TLSN SDK/peer; the corrupted run changes a final attestation. The
emitted documents, session worker and proof engine are real; Node verifies
delivered proofs against the released key and, for bearer-link, the commitments
in the final fixture attestations. The separate runtime suite exercises real
TLSN/notary sessions. Neither substitutes for live consent.

With Docker Compose running:

```sh
pnpm -C ts --filter @libid/ceremony exec playwright install --with-deps chromium firefox webkit
pnpm -C ts --filter @libid/ceremony test:e2e
```

Playwright first builds the qualification artifacts, the runtime fixture and the
harness modules ([build.mjs](../e2e/build.mjs)), then owns startup, readiness and
teardown for pinned SWS/notary containers and the browser harness, so a bare
`playwright test` qualifies current artifacts too. **Browser tests** CI runs nine
independent workspace/engine jobs for popup, ceremony and the dev app. Every
desktop, HTTP and emulated project runs once in its engine's job. Popup tests also
use two parallel workers; ceremony's shared asset controls and heavy runtimes stay
serial within each job. No OAuth credentials are required. Release downloads and
real unauthenticated requests to X/GitHub need network access; unavailable services
fail rather than silently skip. The CRS is the exception: the build step caches each
declared request once, pinned in [crs.pins.json](../e2e/crs.pins.json), and every
project reaches Aztec's CDN hosts through a harness proxy that serves that cache
with the CDN's status and headers ([crs.mjs](../e2e/crs.mjs)); live CDN availability
stays a [qualification gate](qualification.md#remaining-qualification). Every
runtime test retries once, since each runs through the real notary against the X and
GitHub APIs; the real-notary session tests are also tagged `@live`.

The suite uses actual popup connections across HTTP and HTTPS origins in
Chromium, Firefox, WebKit and mobile emulation. Test ports 4980/4986/4987 and
4781–4783/4881–4883 ([topology.ts](../e2e/topology.ts)) are separate from the dev app. Concurrent suite invocations
fail on occupied ports instead of reusing or replacing another run's services.
HTTPS tests use harness certificates and test-runner trust settings; the manual
development app uses loopback HTTP without certificate setup.

| Suite | Coverage |
|---|---|
| [platforms.spec.ts](../e2e/platforms.spec.ts) | Per catalog platform: bound denial, and fixture ceremonies with accepted and corrupted evidence, including released-key verification of delivered proofs. |
| [popup.spec.ts](../e2e/popup.spec.ts) | Actual popup and Callback flows: private handoff, isolation, denial, application continuation, local Callback failures and the Prover progress UI. |
| [isolation.spec.ts](../e2e/isolation.spec.ts) | Independent concurrent connections, a changed Application origin in the same opener window and provider isolation. |
| [assets.spec.ts](../e2e/assets.spec.ts) | Emitted CCDP route policies, Service Worker migration and pending Prefetch joins, Cache Storage/HTTP-cache reuse, Worker failure before OAuth and mounted TLSN initialization. |
| [admission.spec.ts](../e2e/admission.spec.ts) | Harness origin admission and CORS; not production Bridge egress or refresh. |
| [runtime.spec.ts](../e2e/runtime.spec.ts) | The table's real-notary cases: one/two real X sessions and both GitHub endpoints through the matched notary; the GitHub pair runs alongside a separately verified bearer-link fixture proof. |
| [fixtures.ts](../e2e/fixtures.ts) | Harness origins, popup launch, provider answers checked against the platform table, CCDP asset controls and fetch counts, and shared popup assertions. |
| [verify.ts](../e2e/verify.ts) | Released-key verification of generated proofs and rejection of altered public inputs. |

The harness proxies real SWS responses and inserts deployment data into emitted
Callback HTML. It does not reproduce the production Bridge's refresh lifecycle.
The runtime probes use unauthenticated requests; their separate fixture proof is
not bound to their attestations. Real consent, authenticated evidence and physical
devices remain distinct gates. Traces, video and screenshots are disabled.

For focused iteration, select a project or case through Playwright, for example:

```sh
pnpm -C ts --filter @libid/ceremony test:e2e --project=firefox
```

The [dev app's own tests](../../../apps/dev/README.md#checks) cover frontend behavior
with intercepted responses. They are a separate command and do not replace the
ceremony browser suite.

## Manual consent and device checks

Start the [shared dev app](../../../apps/dev/README.md) with `pnpm -C ts dev`.
Use real registrations pointing to its exact callback URI. Complete consent
manually; automated fixtures do not replace these checkpoints.

In progress: the [Bridge live ceremony suite](https://github.com/libid-org/libID-bridge-rs/pull/12)
authorizes real test accounts at GitHub, X and Google and notarizes real
sessions through its own notary against the Platform Verifier's rules. It runs
the Rust prover, not this package's browser prover, so the checkpoints below
stay manual until a live suite drives the browser ceremony.

1. For every platform, try approval and denial, signed-in/out state, cold and
   warm caches, and native provider apps installed/absent where applicable.
2. Run concurrent ceremonies. Close an active popup during preparation,
   authorization and proving; verify the other run and any completed result
   remain independent. Success and denial close automatically in the dev app;
   failed popups remain available for inspection.
3. On physical devices, background the application while Prover remains visible,
   then exercise suspension/resume and memory pressure. Check openerless/native
   app handoff only with the corresponding popup fallback adapter installed.
4. Record component revisions, browser/device versions, nonsecret outcome,
   effective proof-thread information where observed, and total/post-authorization
   timings. Missing measurements are unavailable. Verify produced evidence against
   the matching released verifier before recording cryptographic qualification;
   the dev app's synthetic ledger and success label do not establish this.

Do not bypass CAPTCHA, MFA or consent. Keep callback URLs, credentials, identity
values, transcripts, openings, witnesses and live proofs out of shared logs and
telemetry. DevTools can inspect a failed popup locally; publish only the relevant
sanitized error and component versions. Update the affected traceability rows
when a new qualification result is established.

Full Google and bearer-link proofs, matched-notary concurrency and real timeout
cleanup run once per desktop engine. HTTP and mobile-emulated projects retain
popup interaction, Service Worker, dependency loading and emitted-policy checks;
they do not repeat the expensive proof cases. This does not qualify physical
mobile resource limits or live OAuth behavior.
