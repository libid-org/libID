# Ceremony rebuild: implementation plan and source audit

Updated 2026-09-07. The initial plan was approved for full implementation. The user
removed the old continuous-review protocol and requested three final reviews before
push: security/correctness, API ergonomics, and simplicity. Those reviews ran and
reasonable findings were fixed. Nothing is to be merged. The implementation PR is
stacked on the popup prerequisite; launch qualification remains explicitly incomplete.

The readable package guide is [README](ts/packages/ceremony/README.md), with exact
[evidence and blockers](ts/packages/ceremony/QUALIFICATION.md) and a
[148-ID requirement map](ts/packages/ceremony/TRACEABILITY.md). This plan is working
notes, not a replacement protocol specification.

## Baseline and dependencies

Assigned worktree: `/home/wondertan/src/libid/worktrees/ceremony-rebuild-plan`.
Branch: `feat/ceremony-rebuild-plan`. The suggested `ceremony-rebuild` path already
belonged to another agent and was not modified. Initial creation used latest fetched
main, not the old ceremony branch. Existing reference worktrees remained read-only;
all builds, dependencies, container storage and reports are local to this worktree.

| Source | Exact revision / state | Use |
|---|---|---|
| `origin/main` | `4f205fdf733e3c137543f5f4a8f7281f74377d02` | Initial workspace baseline; unchanged at final remote refresh |
| Architecture PR #13 | `109371854a303ac2e8449d1a1c63163285cbd6a6`, `docs/ceremony-browser-architecture` | Latest remote; all eight documents read and imported unchanged |
| Popup PR #25 | `1c5b78c6f9d783f7b5c536f6018d724b3ced9132`, `feat/popup-package` | Latest remote; exact tracked package consumed, with no replacement machinery |
| Circuits main | `b25bc5b89e595f5bb6049c50446a0edcde47da58` | Latest checked source; only README changes after release |
| Circuits v0.3.0 | `91bc3446eeaa50ab2056d88dd9941374aa4fa34c` | Hash-checked circuits and released verification keys; Noir beta.25 / bb.js 5.2.0 |
| Canonical attestation encoder | `libid-rs` `239a4bb426ac72591fe30006f22660e164a98d96` | Big-endian fixed-width bincode fixture and authority encoding |
| Matched TLSN source | `0f82f54968b36738eacebf7c8ac7728003918b72` | Existing browser JS/WASM pair; hashes in package qualification record |
| libID notary fork PR #6 | `e1b9b80fa718beeaf187f2ec9f32392efaee2e63`, TLSN `816cebcf89480ebf55f58983ec6bab176ea08345` | Inspected successor candidate, not silently mixed with the selected bundle |
| Old ceremony | HEAD `683af7137e58a6581367df2ee1e1ec96482f6a29` plus dirty/untracked work | Individual reuse candidates only |
| Browser reference | HEAD `8b4dcdebc7702ac8e70329f9d1330bc3dcd6b511` plus dirty/untracked work | Executed-path evidence and matched proving integration |

The eight package authorities are ARCHITECTURE, CCDP, CCDP_DISTRIBUTION,
OAUTH_BRIDGE, PROVING, NOTARIZATION, METRICS and TEST_PLAN. The adjacent normative
working files contain the user's newer corrections and are not clean committed
PR contents. Their inspected SHA-256 values are:

- `ceremony-common.md`: `694f3abb1d49f9697c68b57edc07b213434d9e3f2595eabcf858e9e6163d6af9`.
- `platform-ceremonies.md`: `a3e2f6a0570415af76f1fa85c2a0ddab00985e5a4b8b8010aef441d370fac76f`.

Do not present those amendments as merged. Do not copy unrelated old specifications
over main. The implementation follows the user-approved Prover/Client boundary,
absence of local expected-nonce/signature verification, and current released bounds;
remaining source reconciliation is recorded explicitly.

Popup's new default chooses continuity registrations automatically and retains an
exact-scope override. Ceremony receives the application-created connection; it does
not configure application window construction. Its CCDP-owned document entrypoints
pass `/` internally. Popup owns navigation, anchor fallback, authentication,
isolation replacement, MessagePort continuity and closure. Optional WebRTC remains
an external constructor integration.

## Package map

```text
ts/packages/ceremony/
  src/
    primitives.ts, response.ts          small native byte/response leaves
    ccdp/                              seven messages and private fragment codecs
    platforms/
      authorization.ts                 canonical digest and PKCE vectors
      index.ts, types.ts               closed typed catalog and structural results
      assets.ts                        data-only asset catalog
      google/1/                        client, types, assets, token/input/prover
      x/1/                             client, types, assets, transcript/prover
      github/1/                        client, types, assets, exchange/transcript/prover
    client/                            public config and one-shot supplied-connection flow
    callback/                          allowlisted private navigation to Prover
    prefetch/                          root SW, raw-byte cache and pending joins
    prover/
      engine.ts, engine.worker.ts      real dedicated Noir/bb.js backend
      notarization/                    native TLSN worker, framing, decode/correlation
      progress.ts, http.ts, json.ts     shared Prover leaves
      index.ts                         one logical isolated participant
    ui.ts                              fixed native accessible UI
  build/                               emitted graph, release pins, response policies
  e2e/                                 three HTTPS origins, actual popup and real proofs
  ccdp.Dockerfile                       pinned SWS static image
  README.md, QUALIFICATION.md, TRACEABILITY.md
```

Dependency spine: pure encodings/types → platform client leaves → catalog/client;
asset declarations/cache + engine/notarization → platform prover leaves → Prover.
Callback and Prefetch are independent roots. No shared `evidence` package, iframe
coordinator, second prover popup, wallet, transaction submitter or recovery service.

Prover owns token parsing, attestation decoding/correlation and identity extraction.
Client validates structure and wraps copied authorization inputs; it does not repeat
that work. `accepted` is Prover-reported success, not proof authenticity. The ledger
verifier remains authoritative. The separate verifier harness uses released keys;
no on-chain verifier, Solidity generation, RPC or EVM dependency is required.

## One asset declaration, two resource kinds

Each integration owns its non-imported resources. Each platform/version composes
those shared declarations with its circuit exactly once. Execution imports them;
the lightweight metadata catalog never imports execution. Compiler output adds the
real module and nested-worker graph. Prefetch and execution therefore resolve the
same URLs without a second manually maintained first-party filename list.

- Distributed scripts/workers/WASM/circuits are immutable CCDP resources.
- External CRS remains at the native bb.js Aztec hosts with exact ranges and fallback.
  It is not rehosted. Installed-loader probes guard these reviewed upstream requests.
- Pre-OAuth work fetches bytes only. Navigation waits for dispatch acknowledgment,
  not completed downloads, initialized WASM, processed CRS or TLSN sessions.
- Cache identity includes exact URL and Range. Cache Storage stores bodies as 200
  responses and reconstructs ranged responses. Pending joiners receive clones.
- Native bb.js processed-CRS IndexedDB behavior stays inside backend initialization.
- Code owns `verifierTarget: 'evm'`, 2^18 SRS and resource locations. Build-time real
  circuit statistics reject incompatible capacity/toolchain changes.

## Bottom-up batches and verification gates

| Batch | Bounded work | Gate |
|---|---|---|
| 1 | Pure codecs, canonical authorization/attestation leaves and platform types | Canonical vectors, malformed/boundary cases, closed catalog typechecking |
| 2 | Config and supplied-connection Client | Frozen input/config, one-shot sequencing, cancellation, late traffic, generic API checks |
| 3 | Shared resource declarations, byte cache, engine and notary adapter | Exact loader probes, readable single flights, actual returned transcript ceilings, frame/EOF tests, real engine proof |
| 4 | Google/X/GitHub Prover leaves | Pinned witness/public-input vectors, GitHub admission, deterministic transcript selection, overlap/final correlation; real service gates stay explicit |
| 5 | Callback, Prefetch, Prover and fixed UI | Actual-popup private handoff/isolation, authenticated failure, connection continuation, UI timer and concurrent ceremonies |
| 6 | Static compiler graph, policies and accumulated artifact | Real circuit capacity, immutable retention, complete bodies, Brotli, actual built-image HTTP checks |
| 7 | Browser/device/service qualification and final reviews | Chromium/Firefox/WebKit, mobile emulation, released-key real proofs; separate real consent/device/notary gates; three reviews before push |

Pure leaves and Client precede the distribution so the build emits actual runtime
modules. The static-distribution phase is not artificially split into a phase per
helper. No old ledger status is inherited. Full launch claims require the external
qualification gates; a passing mock is never substituted for them.

## Reuse assessment

| Candidate | Decision and reason |
|---|---|
| Old bytes/authorization | Reuse small synchronous native/noble helpers and vectors; revalidate current encoding and widths |
| Old attestation decoder | Adapt read-only canonical decoding; retain upstream digest fixture and preserve u64 timestamps as decimal text |
| Old Google witness/public-input helpers | Adapt to released beta.25/v0.3.0 bounds and separate Prover ownership; actual released-key verification |
| Old progress accounting | Adapt the small weighted tracker; retain monotonicity and terminal cleanup, defer complete metrics |
| Old engine | Adapt dedicated-worker integration; explicit ACVM/ABI/WASM URLs, pinned proof mode, observed threads; static Noir import fixes WebKit module re-entry |
| Old GitHub exchange admission | Replace obsolete full-header disclosure; current hidden-header layout and fresh synthetic canonical fixtures |
| Old orchestration/protocol/popup/deployment | Replace entirely from current documents and existing popup boundary |
| Browser reference asset/proving integration | Reuse concrete loader, CRS, TLSN and overlap lessons; no wholesale port or production fetch interceptor |
| Browser reference GitHub | Simulated protocol evidence only; no claim of a real qualified ceremony |

## Decisions, deviations and blockers

Resolved: no local expected-nonce comparison, no notary-signature verification or
trust-key prefetch, no chain-specific verifier dependency, no styling API, no
complete metrics transport now, no continuous batch-review ledger.

Justified implementation choices include self-contained Callback code; native DOM;
compiler-visible worker edges; exact legacy SW migration and root control before
execution; immutable policy hashes and retained assets; SWS 2.44 boolean/matcher
adaptations checked through real HTTP; and a bounded final-frame EOF wait. Detailed
consequences are in the package qualification record, not hidden in this plan.

Actual unresolved prerequisites:

- Matched TLSN/service probes stall in setup, even for one session. Reestablish a
  matching pair before claiming concurrent X/GitHub notarization.
- X's 30-second deadline lacks a browser-observable issuance anchor and a matched
  request-direction completion hook. A response timeout is not equivalent.
- TLSN's HashMap header interface cannot promise the documented exact ordering.
- Real GitHub service/profile vector, external fallback/signaling, real OAuth
  registrations/accounts and physical devices still require qualification.
- Commit/reconcile the updated normative amendments without importing stale prose.

The complete requirement matrix retains further compound fault/cache/update/device
checks. These are not silently omitted or marked green. The resulting PR must
remain explicitly unqualified for launch while these gates are open.

## Testing, deployment and publication

Use workspace pnpm/Vite/Vitest/Playwright and native browser APIs. Keep generated
artifacts in the assigned worktree. HTTPS browser harness ports are 4681–4683;
SWS uses local 4685; the isolated engine probe uses 4686. Reference servers are not
started, rebuilt or modified. Container storage and browser binaries are worktree-local.

The build emits `public/` plus `sws.toml`; the pinned SWS image copies only these.
Promote through transparent HTTPS ingress on a dedicated cookie-free origin and
retain prior immutable assets throughout the compatibility window. The Bridge is
an independent deployment; its secrets, CORS and callback shell remain outside the
production ceremony package.

The opt-in headed walkthrough installs no OAuth mocks and pauses for real consent,
foreground/suspension and outcome checkpoints. Logs/reports exclude OAuth returns,
credentials, transcripts, openings and witnesses. Real devices remain mandatory
where emulation cannot establish behavior.

Commit with the configured human identity, matching DCO sign-off and
`Assisted-by: GPT-6`. GPG may be disabled as explicitly authorized. Run the three
requested reviews and fix reasonable findings before pushing. Rebase the isolated
implementation onto the exact popup prerequisite without merging shared branches,
then create a stacked PR. Do not merge any PR.

### Read-only working-source locations

- Architecture: `/home/wondertan/src/rust/dyaka/worktrees/libid-ceremony-architecture-pr13`.
- Popup: `/home/wondertan/src/rust/dyaka/worktrees/libid-popup-impl`.
- Browser evidence: `/home/wondertan/src/rust/dyaka/worktrees/ceremony-browser-architecture`.
- TLSN source: `/home/wondertan/src/rust/dyaka/worktrees/tlsn-reclaimed-io`.
- Old ceremony: `/home/wondertan/src/libid/libid/ts/packages/ceremony`.

These historical research paths belong only in working notes, not package guides.
