# Browser integration and proving qualification

Uses actual `@libid/popup` connections across three local HTTPS origins. Browser
proofs are checked outside the browser against the released verification key.

- [Requirement index](test-plan.md): stable acceptance IDs.
- [Traceability](traceability.md): automated, partial, external and deferred coverage.
- [Qualification](qualification.md): setup, exact pins, evidence and missing release gates.

[flow.spec.ts](../e2e/flow.spec.ts) covers document flows and controlled Google fixture
proofs. [server.mjs](../e2e/server.mjs) hosts HTTPS origins on ports 4881–4883 and HTTP origins on 4781–4783 and requires a proxy target for
the actual built SWS image. [smoke.ts](../e2e/smoke.ts) and [server-smoke.mjs](../e2e/server-smoke.mjs)
provide the opt-in proof/notary runtime lane on port 4686. The
[manual consent walkthrough](../../../qualification/ceremony/walkthrough.mjs) installs
no OAuth mocks. Synthetic exchanges and mobile emulation are not real-platform or
physical-device qualification.

[callback.ts](../e2e/callback.ts) demonstrates data-only insertion into the emitted
Callback HTML and composes its hash-only script policy. It is deliberately a
harness helper, not the production Bridge refresh/cache lifecycle. Its
`connect-src 'none'` tests the deployment without an optional fallback adapter;
configured fallback connectivity requires separate qualification.

Build `pnpm --filter @libid/ceremony build:qualification-artifacts` before this
harness. It reads `.cache/qualification-assets`; its app uses the shared synthetic
ledger fixture. No ledger definition or decoder is included in the Prover.
For actual SWS tests, build the image from this test
artifact and set `CEREMONY_ARTIFACT_DIR` to its absolute path when running
`test:distribution`, alongside `CEREMONY_SWS_URL`.

The standalone smoke lane also uses SWS: `node e2e/build-smoke.mjs` emits
`.cache/smoke/public/` and `sws.toml`. Run the pinned SWS against that output on a
separate local port, then set `CEREMONY_SWS_URL` for `node e2e/server-smoke.mjs`.
Both HTTPS harnesses stream upstream responses; neither implements static-file
HTTP semantics. App/Bridge/control fixtures remain test-only handlers.

Set `CEREMONY_SWS_BINARY` to the binary extracted from the pinned image when
running `test:distribution` to include the same-length ETag rebuild regression.
It uses a temporary directory under `.cache/` and port 4687 (override with
`CEREMONY_SWS_TEST_PORT` if another server already uses that port).

The same ceremony browser suite also runs on HTTP loopback in Chromium, Firefox
and WebKit (`*-http` projects, ports 4781–4783). It uses the emitted distribution
and actual popup package, checking secure contexts, isolation and worker continuity
without certificate bypasses. Existing HTTPS projects remain deployment coverage.
The `@libid/dev` frontend tests use HTTP port 4692 and no TLS setup.
