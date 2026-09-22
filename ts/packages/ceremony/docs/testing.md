# Testing

Use Node 24+, pnpm and the frozen workspace lockfile. All commands below run
from the repository root. [Qualification](qualification.md) records evidence and
release gaps; [traceability](traceability.md) maps the stable
[test requirements](test-plan.md) to assertions and remaining properties.

## Unit and type checks

```sh
pnpm -C ts install --frozen-lockfile
pnpm -C ts --filter '@libid/ceremony...' build
pnpm -C ts --filter @libid/ceremony typecheck
pnpm -C ts --filter @libid/ceremony typecheck:e2e
pnpm -C ts --filter @libid/ceremony test
```

Unit tests sit beside their source owners. Canonical fixtures cover authorization,
JWT/circuit inputs and signed attestation decoding. Worker and pipeline mocks
exercise failures and scheduling; they do not establish real proving or runtime
concurrency. Workspace CI runs build, unit tests, lint and formatting separately
from the browser job.

## Distribution checks

```sh
pnpm -C ts --filter @libid/ceremony build:ccdp-artifacts
pnpm -C ts --filter @libid/ceremony test:distribution
```

These Node tests exercise archive handling, emitted resources and header rules,
circuit capacity and the installed dependency loaders. **HTTP and native-binary
checks are conditional**: a default run skips them unless their service/binary
inputs are supplied. A green default run is not the complete distribution
qualification.

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
Those tests start their own servers on `CEREMONY_SWS_TEST_PORT` (default 4687) and
the next port; set `CEREMONY_SWS_TEST_PORT=4988` when the dev notary already
occupies 4687. These inputs are test-only. The workspace **CCDP image** CI job runs
all of them against the freshly built image and the pinned binary.

## Browser tests

With Docker Compose running:

```sh
pnpm -C ts --filter @libid/ceremony exec playwright install --with-deps chromium firefox webkit
pnpm -C ts --filter @libid/ceremony test:e2e
```

The command builds qualification artifacts and runtime fixtures. Playwright owns
startup, readiness and teardown for pinned SWS/notary containers and the browser
harness. The workspace **Browser tests** CI job runs the same command alongside
the popup and dev-app suites. No OAuth credentials are required. Release downloads and real unauthenticated requests to
X/GitHub need network access; unavailable services fail rather than silently skip.

The suite uses actual popup connections across HTTP and HTTPS origins in
Chromium, Firefox, WebKit and mobile emulation. Test ports 4980/4986/4987 and
4781–4783/4881–4883 are separate from the dev app. Concurrent suite invocations
fail on occupied ports instead of reusing or replacing another run's services.
HTTPS tests use harness certificates and test-runner trust settings; the manual
development app uses loopback HTTP without certificate setup.

| Suite | Coverage |
|---|---|
| [flow.spec.ts](../e2e/flow.spec.ts) | Document/connection lifecycle, emitted policies, selected assets, caching, UI and controlled Google proof generation. |
| [admission.spec.ts](../e2e/admission.spec.ts) | Harness origin admission and CORS; not production Bridge egress or refresh. |
| [runtime.spec.ts](../e2e/runtime.spec.ts) | Real bearer-link fixture proof and one/two matched-notary sessions alongside a separate real proof. |
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
