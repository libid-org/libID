# Browser integration and proving qualification

The Playwright suite uses actual `@libid/popup` connections across three local
origins, over both HTTPS and HTTP loopback. Chromium, Firefox, WebKit and mobile
emulation run the same suite. Mobile emulation does not qualify physical devices.

- [Requirement index](test-plan.md): stable acceptance IDs.
- [Traceability](traceability.md): automated, partial, external and deferred coverage.
- [Qualification](qualification.md): evidence, manual consent checkpoints and remaining release gates.

From the repository root, with Node 24+, pnpm and Docker Compose available:

```sh
pnpm -C ts --filter '@libid/ceremony...' build
pnpm -C ts --filter @libid/ceremony exec playwright install --with-deps chromium firefox webkit
pnpm -C ts --filter @libid/ceremony test:e2e
```

The command builds the emitted CCDP and runtime fixtures. Playwright starts the
pinned SWS images, matched notary and browser harness, waits for readiness, and
stops the services afterwards. Each invocation owns its containers; test ports
4980/4986/4987 and 4781–4783/4881–4883 are separate from the development app.
Concurrent test invocations on those ports fail rather than reuse another run.

The separate **Ceremony e2e** CI job runs this command. No OAuth credentials are
required. Release downloads and the notary's unauthenticated HTTPS requests to
X require network access; unavailable services fail the tests rather than skip
coverage. Traces, video and screenshots remain disabled.

[flow.spec.ts](../e2e/flow.spec.ts) covers document flows, emitted policies,
resource loading and a controlled Google proof. [runtime.spec.ts](../e2e/runtime.spec.ts)
adds a real bearer-link fixture proof and one/two concurrent notary sessions
alongside a separate fixture proof. [verify.ts](../e2e/verify.ts) checks generated
proofs in Node against their released keys and rejects changed public inputs.
The runtime cases exercise real WASM and a real matched notary; they do not
establish authenticated OAuth or bind their fixture proof to those attestations.

The [browser harness](../e2e/server.mjs) proxies CCDP responses from SWS without
implementing static-file semantics. [callback.ts](../e2e/callback.ts) prepares
data-only insertion into emitted Callback HTML and its hash-only script policy;
it does not implement the production Bridge refresh/cache lifecycle. Its
`connect-src 'none'` covers deployments without an optional fallback adapter.

Distribution checks remain a separate command. After building the qualification
artifact, point `CEREMONY_ARTIFACT_DIR` at its absolute directory and
`CEREMONY_SWS_URL` at a SWS instance serving it, then run `test:distribution`.
Set `CEREMONY_SWS_BINARY` to the binary extracted from the pinned image to include
the same-length ETag regression. Its port defaults to 4687; use
`CEREMONY_SWS_TEST_PORT` when that port is occupied.
