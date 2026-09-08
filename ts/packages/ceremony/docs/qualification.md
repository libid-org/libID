# Qualification and release prerequisites

Status: **launch qualification incomplete**.
Security/correctness, API ergonomics and simplicity were independently reviewed.
Reasonable findings were fixed and targeted checks rerun. No predecessor review
ledger or completion state is inherited. [TRACEABILITY.md](traceability.md) accounts
for every stable requirement ID, including partial, external and deferred coverage.

## Inputs

| Input | Pin |
|---|---|
| Workspace main | `4f205fdf733e3c137543f5f4a8f7281f74377d02` |
| Architecture PR #13 | `412df215b93473f79fae75df602f6b0be42b13a9`; eight source documents consolidated with implementation guides in the package docs directory; package composition updated for grouped CCDP documents |
| Popup PR #25 / stack base | `1c5b78c6f9d783f7b5c536f6018d724b3ced9132` |
| Circuits release | `v0.3.0`, commit `91bc3446eeaa50ab2056d88dd9941374aa4fa34c` |
| Latest circuits source checked | `b25bc5b89e595f5bb6049c50446a0edcde47da58`; only README changes after release |
| Noir/Nargo and bb.js | `1.0.0-beta.25`, `5.2.0`; generation and independent verification explicitly use `verifierTarget: 'evm'` |
| Circuit manifest SHA-256 | `ac57707b323e507848916b723073bce319df6cb09115c86fea5b6eb2c13e1ab9` |
| Canonical attestation encoder | `libid-rs` `239a4bb426ac72591fe30006f22660e164a98d96` |
| TLSNotary bundle source | `0f82f54968b36738eacebf7c8ac7728003918b72` |
| TLSNotary JS SHA-256 | `4c852975717036cc9f5b3dff3b07f610b36ee01c05fa84003bb6034580898db2` |
| TLSNotary WASM SHA-256 | `fcfe23bdbaab4bf8349229e8fb9cefdfacea687543bed9072d5fdfb2c93a133e` |
| SWS | `2.44.0`; image digest in `ccdp.Dockerfile` |

The separate libID notary fork PR #6 at
`e1b9b80fa718beeaf187f2ec9f32392efaee2e63` and its TLSN dependency
`816cebcf89480ebf55f58983ec6bab176ea08345` are successor candidates, not interchangeable
with this bundle. Qualify a matched pair before replacing either member. The older
published notary v0.2.0 browser bundle lacks the required reclaimed-channel finish
contract and is not an acceptable substitute.

## Evidence obtained

- TypeScript package/harness checks, declaration emission, workspace formatting and
  lint; focused canonical, authorization, parser, client, cache and worker tests.
- Actual worker-handler tests accept returned transcripts at 4 KiB/32 KiB and reject
  one byte over before `send` resolves, with a deliberately permissive SDK. A missing
  final EOF expires the finalization deadline. These are adapter tests, not real TLSN.
- Native installed ACVM/ABI WASM loaders, bb.js WASM loader and primary/fallback CRS
  loaders run with an observing fetch stub and external hosts blocked. This checks
  request methods, cache modes, URLs, ranges and primary/fallback ordering; synthetic CRS bodies in this probe are never proof evidence.
- Generated body hashes, exact per-platform sets, retained immutable responses and
  Brotli roundtrips. Every emitted HTTP response is checked against actual SWS.
  The deployment image was built and used behind the HTTPS browser harness; only
  its local listening port was changed to accommodate rootless host networking.
- Actual popup launch, native-anchor fallback, private callback forwarding,
  isolation, denial and application continuation in Chromium, Firefox and WebKit.
  A same-script legacy nested registration is seeded; execution joins a delayed
  root-worker prefetch without a second server download.
- Real bearer-link browser proofs in Chromium, Firefox and WebKit and a real Google
  browser proof in Chromium verified against the released keys. Effective proof
  backend observations report shared memory and two threads in this isolated lane.
- Real Google fixture proving in Chromium, Firefox and WebKit through the emitted
  distribution and generated CSP,
  using the actual popup package and a separate released-key verification process.
  Fixture time/JWKS/OAuth return are controlled. WebKit bypasses Playwright routing
  for the controlled-page JWKS fetch, so this one public fixture response is supplied
  at the page fetch boundary. Live JWKS CORS/CSP behavior is not qualified by this
  test; proof assets still use their real native loaders. The fixture uses its own known
  digest: this is runtime/key compatibility, not real consent or authorization for
  the harness transaction. Public-input mutation must fail independent verification.

The ledger-integration run passed 180 ceremony units, 3 ledger units and all 7
artifact/loader/actual-SWS checks. The five-profile browser matrix passed 44/45
cases, including every real Google proof and independent verification. WebKit's
two-concurrent-popup case observed only one completion before its 15-second test
deadline. Five immediate focused repetitions passed. The cause is unresolved;
these repetitions do not establish a consistently passing concurrency gate.

The subsequent Callback input-list update passed 183 ceremony units, all 7
artifact/loader/actual-SWS checks, and 15 targeted Callback/private-return browser
cases across all five profiles. Loader tests now read metadata and bodies from the
same selected artifact directory; no matching production build is required.

The executable matrix is `e2e/flow.spec.ts` plus `playwright.config.ts`. Final run
counts and browser versions are recorded in the PR; ignored local reports carry
controlled fixture outputs. Real OAuth traces, callback URLs, credentials,
transcripts, openings and witnesses are never qualification artifacts.

## Ledger fixture scope

The real `@libid/ledger` package supplies the public interface and production decoder;
real ledger definitions are intentionally deferred by user instruction. Production
`decode` rejects every identifier, including testing identities. The shared testing
entrypoint exercises encode/decode, immutable hash bytes and code-owned network
classification with synthetic values only. Ceremony unit tests and the local browser
harness alias that same fixture into Client and Prover. `build:qualification-artifacts`
restricts these builds to `.cache/`; normal production builds use the real package.
This verifies ceremony integration, not real-ledger support or Chain Profile vectors.
A real ledger definition is required before a production ceremony can be constructed.

## Actual blockers and unqualified boundaries

1. **Matched notary service:** both single-session and concurrent browser probes
   against `https://notary.testnet.lib.id` reached WASM initialization and WebSocket
   opening but stalled in `Prover.setup`; the single-session run was aborted at
   120 seconds. Proof-backend initialization completed concurrently. Checking the
   earlier 8-KiB SDK receive setting produced the same stall; production keeps the
   documented 32-KiB acceptance ceiling. This is no evidence of real TLSN concurrency
   or a qualified X/GitHub ceremony. Reestablish a matched service/bundle, then run
   the real profiles and correlate every final output.
   These historical probes used the development override address, not the newly
   documented `https://testnet.notary.lib.id`. Both fixed network selections and
   matched browser/Bridge sessions remain unqualified against live services.
2. **X request deadline:** REQ-PLAT-33 / LIBID-BROWSER-010 require complete request
   receipt at X before its 30-second authorization-code deadline. The documents do
   not define a browser-observable issuance anchor. The pinned SDK exposes
   request-start and completion only after the response body; it exposes no
   request-direction-only completion signal. A timeout around `send_request()`
   would incorrectly reject allowed later responses. No such substitute is used.
   A matched SDK/service observation contract and delayed-request qualification are
   required before claiming this requirement. This production enforcement remains
   unresolved, not a waived security property.
3. **Exact HTTP profile ordering:** the pinned TLSN SDK accepts request headers in
   a Rust `HashMap`. The current profile prose prescribes an order which that API
   does not guarantee. Selectors validate the complete permitted header set,
   uniqueness, values and bearer placement against the actual transcript, but do
   not claim exact order. A matching SDK serializer/profile decision is needed.
4. **GitHub service:** no real confidential token-exchange service was qualified.
   Admission implements the current hidden-header, separately disclosed field
   profile. Its tests use a synthetic canonical-bincode record, not a signed
   released GitHub service vector. The obsolete fully revealed request-head layout
   is rejected. Obtain a matching service/profile vector and real `/user` evidence. The Bridge
   must admit exactly one valid `Origin` equal to `ccdpOrigin` independently on
   every preflight and POST, before DNS or session work; application-allowlist
   membership grants no admission to this route. It must use the Prover-supplied canonical `notaryAddress` unchanged, with no second
   mapping/override, and reject redirects and forbidden internal destinations,
   including DNS-resolved destinations. Unit origin validation is not server egress
   protection; those service controls and both network selections remain unqualified.
5. **Devices and optional carrier:** real iOS/Android devices, native platform apps,
   Vanadium, background scheduling/memory pressure and corresponding optional
   fallback adapters/signaling were unavailable. Desktop engines and mobile
   emulation cannot satisfy these gates. No replacement WebRTC code is supplied.
The nonce/signature-check and released-bound normative amendments are now committed
in architecture PR #13 at `5cfbf47` (included in the pinned documentation head).
They are no longer an uncommitted-source prerequisite.

Callback now ships as `/ccdp/callback.html`, including clearing, bundled version
selection, local unsupported-version UI, and all dependencies. The test Bridge
prepares the HTML and hash-only CSP from this artifact with escaped deployment
JSON. Production Bridge refresh, conditional revalidation, redirect rejection,
compressed-source handling, atomic replacement/last-good retention, and ingress
log redaction still require external deployment qualification; the harness loads
the emitted source at startup and does not implement that server lifecycle.

Complete metrics transport, timing coverage and the full documented diagnostic-span
catalog are deferred by user instruction. Coarse package-owned progress, worker
capability observations and targeted download counts remain. No fabricated zero
metrics, speculative transport, or second protocol message family is introduced.
Real build-time circuit statistics match 42,006 and 179,443 gates and reject
insufficient launch capacity. Negative browser-proof SRS-floor execution and the
complete cache/update fault matrix are not claimed; their remaining properties are retained in the index.

## Implementation deviations with consequences

- `LIBID-OAUTH-003` in the pinned source still names raw `chainId` input, conflicting
  with its updated `LIBID-MOD-014/015` and Client API. The local requirement row keeps
  its ID but names `LedgerId` and a decoder-derived hash, matching the current API.

- SWS 2.44 requires boolean `text-charset = false`; the document's empty-string
  value fails configuration parsing. Its header matcher appends the resolved file
  basename to the request path, even for files. The compiler emits matching rules;
  actual public routes and policies are unchanged. See the upstream
  [configuration](https://static-web-server.net/v2/configuration/config-file/) and
  [header implementation](https://github.com/static-web-server/static-web-server/blob/v2.44.0/src/custom_headers.rs).
  Explicit SHA-256 ETags are emitted because this server does not generate them.
  Conditional-GET/304 behavior is not claimed.
- Execution workers explicitly carry `Cross-Origin-Embedder-Policy: require-corp`.
  A real Firefox proof otherwise fails before worker bootstrap; the isolated engine
  harness had already supplied this header. The generated policy and immutable URL
  digest now include it for every execution worker, including leaves.
- The known stale `/ccdp/v1/` registration is retired only when all its workers use
  the exact canonical script URL. Root is selected explicitly. Unrelated scopes
  are untouched. Firefox's isolated document can initially be uncontrolled, so a
  same-origin root-worker claim handshake finishes before `ProverReady`. This is
  cache ownership, not popup carrier or MessagePort continuity machinery.
- Callback is self-contained. Prefetch/Prover HTML clears the URL in the first
  inline script before its inline module entry imports dependencies. Build-owned
  worker AST edges expose nested workers to graph traversal; they do not scrape
  generated dependency text or change native Worker execution.
- The build replaces bb.js's unused embedded default-WASM URL modules with its
  owned threaded-WASM URL; actual initialization uses supported `wasmPath`. This
  avoids duplicate embedded WASM chunks. Native CRS hosts/ranges are untouched;
  there is no production fetch interception or external-CRS rehosting.
- Immutable execution paths include a response-policy digest, and compatible
  rebuilds retain prior assets plus their original headers. Promotion must preserve
  that accumulated artifact for the compatibility window. Removal/garbage collection
  requires a separate release decision.
- The final notary finish/frame/EOF phase has a 30-second terminal deadline, separate
  from proof generation and X's authorization-code deadline. It prevents an otherwise
  unbounded incomplete frame from retaining a worker. Real-device timing remains a
  qualification gate. Transcript ceilings are acceptance checks, not network caps.

## Repeatable opt-in real consent

Use a dedicated test application built against this package, a deployed Bridge
allowlisting its HTTPS origin, the emitted CCDP distribution, and real provider
registrations with exact redirect URIs. For GitHub, provision secrets only in the
Bridge's secret store. Do not place secrets in command arguments, reports or chat.

```sh
CEREMONY_WALKTHROUGH_URL=https://your-test-application.example \
CEREMONY_BROWSER=chromium \
  node ts/qualification/ceremony/walkthrough.mjs
```

The runner opens a real headed browser, installs no OAuth mocks, and stops at manual
consent/foreground/suspension/outcome checkpoints. Its ignored report records only
checkpoint labels, browser version and optional application `window.result.status`;
that status is Prover-reported, not verification. Repeat approval and denial for each
platform, app-installed/app-absent and signed-in/signed-out conditions. Never bypass
CAPTCHAs, MFA or provider consent screens.

On physical iOS/Android, repeat the same walkthrough in the system browser and
record model, OS/browser version, declared proof/TLSN thread pools and only nonsecret
outcomes. Exercise suspension, eviction, popup defaults, openerless/same-tab returns,
ignored close and application resumption. A mismatched/absent fallback must fail
closed. Qualify both normal isolation and popup-managed fallback responses.

Separately run `e2e/build-smoke.mjs`, `e2e/server-smoke.mjs` (HTTPS port 4686), and
`ts/qualification/ceremony/run-smoke.mjs <browser> <google|bearer|notary|notary-single>`
with the same pinned artifacts. The notary smoke uses a public unauthenticated
request and records lengths only; it diagnoses runtime concurrency and cannot
replace real X token/identity or GitHub profile qualification. The independent
verifier consumes the released key, never a key recomputed by the proving backend.
No chain, contract deployment, RPC, wallet or local browser verifier is required.
