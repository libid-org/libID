# Architecture

Ceremony obtains identity evidence for an application-owned operation. The caller
supplies a popup connection and keeps control of its lifetime. Prover extracts
identity and builds evidence; Client checks the result structure and assembles
`OAuthProof`. Neither performs final cryptographic verification in the browser.

## Ownership

| Owner | Responsibility |
|---|---|
| [ccdp/client](../src/ccdp/client/ceremony.ts) | Fetch/freeze Bridge config, derive authorization inputs, run one ceremony, validate and assemble its result. |
| [ccdp/index](../src/ccdp/index.ts), [navigation](../src/ccdp/navigation.ts) | Browser-free message companions and route/fragment codecs. |
| [ccdp/documents](../src/ccdp/documents/) | Callback, Prefetch/Worker and Prover entrypoints; native package-owned UI. |
| [platforms](../src/platforms/index.ts) | Client-safe catalog; each platform/version owns URL construction, validators, assets, events and its execution pipeline. |
| [barretenberg](../src/barretenberg/engine.ts) | Dedicated Noir/bb.js proof worker, circuits and input adapters. |
| [notary](../src/notary/session.ts) | TLSNotary sessions, HTTP/transcript helpers, canonical decoding and evidence correlation. |
| [assets](../src/assets/index.ts) | Resource declarations and resolution, root Worker registration, byte caches and pending fetches. |
| [build](../build/distribution.ts) | Compile the dependency graph and emit static files and response policies. |
| [events](../src/events.ts), [errors](../src/errors.ts) | Shared operation feed, stage projection and bounded failure text. |

The two public entrypoints are `@libid/ceremony` (discovery, result types and
`CeremonyError`) and `@libid/ceremony/ccdp/client` (the client and subscriptions,
plus the root exports). Codecs, document startup, execution and build helpers
are private. See the [client guide](client.md) for application use.

## Document lifecycle

1. **Prefetch**, on the CCDP origin, authenticates the connection, activates the
   canonical root Worker and dispatches the selected assets. Its completion
   event permits Client to navigate to the provider; downloads may continue.
2. **Callback**, on the Bridge origin, captures and clears the OAuth return
   before other work. Its self-contained HTML selects bundled CCDP code and
   validates the Bridge's inserted deployment data. It authenticates Application,
   reports the authorization return, and navigates privately to Prover.
3. **Prover**, on the CCDP origin, accepts only Callback's authenticated
   `connection.peerOrigin`, forwarded in the private fragment. That origin is
   never inferred from OAuth fields or allowlist order. After popup connection
   readiness, isolation checks and root-worker claim, Prover requests inputs
   through `prover.started`, runs the selected pipeline and sends one outcome.

The [CCDP specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md)
owns the five messages, routes and permitted transitions. Message companions
check exact shape and bounds; the receiving Client/document enforces state and
cardinality. Readiness processing does not depend on event subscriptions.
Unknown extension events cannot authorize a transition or complete a ceremony.

Popup owns window creation, native-anchor fallback, authentication, navigation,
isolation replacement, port continuity and closure. Ceremony's root Worker
composes popup's keeper with asset fetching; it adds no handshake or transport.
Callback installs no Worker. Application, documents and Worker must use compatible
popup transport versions, including the authenticated-origin handoff.

Proving stays in the foreground popup. A shared abort signal tears down reachable
workers and private state after delivery, denial, failure or connection loss.
There is no persistent proof checkpoint, application iframe prover, Job store,
wallet operation or transaction submission inside this package.

## Import boundaries

The client-safe catalog imports URL builders, proof validators and event
metadata. It never imports platform execution. Prover lazily imports execution
leaves; those leaves do not import the catalog selecting them.

Shared integrations declare resources once in `*.assets.ts`; platform/version
leaves compose those handles. Prefetch imports only this data-only catalog.
The compiler adds actual chunks and nested-worker edges to each selected set.
Execution resolves the same handles. Fetching scripts as bytes before OAuth
never initializes WASM, proof backends or TLSNotary sessions.

[Platform pipelines](pipelines.md) compose the independent proving and notary
modules. Early transcripts and commitment openings permit overlap, but proof
delivery joins every required final attestation and correlation.

## Versioning and compatibility

Client intersects the local platform catalog with Bridge-advertised versions.
An explicit version selects a compatible member; omission chooses the greatest
common version. Each run freezes its selection. Version semantics may differ in
disclosure behavior, so an application promising a specific behavior selects it
explicitly.

Platform ceremony, CCDP, popup transport and Bridge API versions have separate
owners. Internal UI or asset changes need no platform ceremony version when the
proof semantics remain compatible. Only version 1 is implemented today;
[adding another version](pipelines.md#adding-a-platform) also requires changes
to the Prover dispatcher and distribution build.

## Code and documentation conventions

Keep cross-module rationale here, user contracts in the client/deployment guides,
and byte layouts, limits, ownership and ordering comments beside their code.
Link normative encodings instead of defining them again. Fixtures sit beside
owning tests as `.fixture.*`; package contents exclude tests and fixtures.

Use workspace Biome formatting: two spaces, single quotes, no semicolons and
organized imports. Separate declarations and methods with a blank line. JSDoc
explains meaningful input, lifetime and failure constraints; internal comments
explain invariants rather than restating types. Run `pnpm -C ts lint` and
`pnpm -C ts fmt:check` for mechanical checks.
