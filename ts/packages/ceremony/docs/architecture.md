# Ceremony package architecture

`@libid/ceremony` obtains platform evidence for an Application-owned operation
and returns separate identity and OAuth proof values. Application supplies a
`@libid/popup` connection; ceremony neither creates nor closes it. Result
acceptance is structural, not ledger verification.

[CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md) and its
[Bridge](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/oauth-bridge.md) and
[Distribution](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md) contracts own interoperability.
This document owns module boundaries and their rationale. The [client guide](client.md)
owns the public API, [qualification](qualification.md) records remaining gaps,
and the [test index](test-plan.md) retains the stable acceptance IDs.

## Ownership

| Module | Responsibility |
|---|---|
| `ccdp/client` | Fetch/freeze configuration, construct authorization, run one-shot ceremonies, validate result structure, assemble OAuthProof. |
| `ccdp/index`, `ccdp/navigation` | Browser-free message companions and route/fragment codecs. |
| `ccdp/documents` | Callback, Prefetch/Worker, Prover, and shared native UI entrypoints. |
| `platforms/<platform>/<version>` | Authorization URL, proof types/validators, asset declarations, and the platform pipeline. |
| `platforms/authorization` | Shared digest and PKCE helpers selected by each version, not another version boundary. |
| `barretenberg` | Dedicated Noir/bb.js proof worker and circuit adapters. |
| `notary` | TLSNotary sessions, transcript interpretation, canonical attestation decoding, and correlation. |
| `assets` | Data-only declarations, runtime resolution, root Worker byte caches and pending-fetch joins. |
| `build` | Compile the closed resource graph and emit the static distribution. |

The package has two public entrypoints:

- `@libid/ceremony`: client-safe platform discovery, `CeremonyError`, and result types.
- `@libid/ceremony/ccdp/client`: `createCCDPClient`, ceremony lifecycle and
  event/stage APIs, plus the root exports.

Document startup, codecs, platform execution, and build helpers are private.
The [source guide](source.md) links their implementations and code conventions.

## Why the boundaries look this way

### Application state and popup lifetime

Each Ceremony owns its in-memory handlers on the supplied connection, not a Job
store or application-wide OAuth lookup. The caller freezes operation inputs and
may retain an accepted result for later submission. A lost unfinished ceremony
starts again with fresh OAuth; application-level resumptions remain independent.

Application already controls the authorized operation. Keeping raw OAuth returns
inside the popup reduces transient credential exposure; it cannot protect human
intent from compromised Application code. Prover extracts evidence and identity;
Client validates the separate identity/proof structures and their selected
platform/client/version binding. It does not repeat evidence parsing or perform
cryptographic verification. The Ledger Verifier remains authoritative.

The connection can carry an Application composition before and after ceremony.
Ceremony settles its own result and makes later CCDP traffic inert without
closing that connection. It imports no wallet, job, connector, registry, or
transaction-submission implementation.

### Browser documents and execution

Callback runs at the OAuth Bridge origin because that is the registered redirect
authority. Prover and its assets can be hosted independently on the CCDP origin.
Proving runs in the foreground popup: an Application-level background iframe can
be suspended or throttled on mobile. Popup owns isolation selection and carrier
continuity, so ceremony does not coordinate duplicate provers or inspect browsers.

The [document entrypoints](documents.md) are compiler inputs, not public package
APIs. Callback is a self-contained HTML artifact; Prefetch/Prover embed their
clearing bootstrap and entry code. The Worker composes byte caching with popup's
keeper handler. Callback installs no Worker. The implementation's outstanding
origin-continuity update is explicit in [qualification](qualification.md#pending-contract-updates).

### Lightweight declarations, shared execution resources

`platforms/index` imports only client-safe URL and proof-validator leaves.
Prover lazily imports platform execution; those leaves never import the catalog
that selects them. This keeps proving runtimes out of Application bundles.

Shared integrations declare resources once in `*.assets.ts` leaves. Each platform
composes those handles with its circuit; `platforms/platforms.assets.ts` collects
the resulting versioned sets. Prefetch and the build import that data-only
catalog. Execution imports the same declarations, never the reverse. This is an
explicit dependency boundary, not a hope that tree-shaking removes side effects.

The [build](build.md) resolves archives and wildcard members, records actual
compiler chunks/nested workers, and checks the catalog covers the supported
platform/version set. Runtime `resolve()` is synchronous; source fetching and
archive extraction never enter browser bundles. Prefetch warms bytes only,
and execution joins outstanding downloads rather than starting another fetch.

### Proving and notarization

[Platform pipelines](pipelines.md) overlap backend preparation, evidence work, and
proof generation where their dependencies permit it. Final delivery still joins
the proof and every required attestation. [Notarization](notarization.md) separates
TypeScript transcript policy from the WASM cryptographic/session machinery;
canonical signed bytes survive unchanged for downstream verification.

One [operation feed](metrics.md) supports readiness, local UI, and optional
Application tracing. User-facing stages are a sequential projection, not another
protocol or a restriction on concurrent work.

## Versioning and compatibility

The local catalog exposes supported platform ceremony versions; Bridge config
filters it to enabled versions. An explicit trailing version argument selects
one compatible member, otherwise Client selects the greatest common version.
Each live ceremony freezes its choice.

Platform ceremony versions own authorization, OAuth, and proof/output semantics.
Internal asset or UI changes do not add a public version when those semantics
remain compatible. CCDP and popup connection versions are independent, as defined
by their specifications; the Bridge JSON API has its own boundary. This avoids
inventing independent versions for every helper while retaining cross-component
compatibility checks.

[Pending contract updates](qualification.md#pending-contract-updates) identify
coordinated changes not yet implemented. Other guidance describes current code,
not a second competing protocol specification.
