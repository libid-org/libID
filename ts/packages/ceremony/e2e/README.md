# Browser integration and proving qualification

Uses actual `@libid/popup` connections across three local HTTPS origins. Browser
proofs are checked outside the browser against the released verification key.

- [Requirement index](../docs/test-plan.md): stable acceptance IDs.
- [Traceability](../docs/traceability.md): automated, partial, external and deferred coverage.
- [Qualification](../docs/qualification.md): setup, exact pins, evidence and missing release gates.

[flow.spec.ts](flow.spec.ts) covers document flows and controlled Google fixture
proofs. [server.mjs](server.mjs) hosts the origins on ports 4681–4683 and can proxy
the actual built SWS image. [smoke.ts](smoke.ts) and [server-smoke.mjs](server-smoke.mjs)
provide the opt-in proof/notary runtime lane on port 4686. The
[manual consent walkthrough](../../../qualification/ceremony/walkthrough.mjs) installs
no OAuth mocks. Synthetic exchanges and mobile emulation are not real-platform or
physical-device qualification.

[callback.ts](callback.ts) demonstrates data-only insertion into the emitted
Callback HTML and composes its hash-only script policy. It is deliberately a
harness helper, not the production Bridge refresh/cache lifecycle. Its
`connect-src 'none'` tests the deployment without an optional fallback adapter;
configured fallback connectivity requires separate qualification.

Build `pnpm --filter @libid/ceremony build:qualification-artifacts` before this
harness. It reads `.cache/qualification-artifacts`, where the test build aliases
`@libid/ledger` to the shared [testing fixture](../../ledger/README.md#shared-test-fixture).
The app and Prover use the same decoder. No real ledger is implied; normal production
builds exclude the fixture. For actual SWS tests, build the image from this test
artifact and set `CEREMONY_ARTIFACT_DIR` to its absolute path when running
`test:distribution`, alongside `CEREMONY_SWS_URL`.
