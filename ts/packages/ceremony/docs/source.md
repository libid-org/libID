# Ceremony source

[Package architecture](architecture.md) defines the boundaries and public
exports. The guides below describe each module and its contract.

- [CCDP client](client.md#implementation-guide): configuration and caller-side ceremony state.
- [CCDP](protocol.md#implementation-guide): message codecs and [document entrypoints](documents.md#implementation-guide).
- [Platforms](pipelines.md#implementation-guide): authorization, versioned proofs and pipelines.
- [Barretenberg](proving.md#implementation-guide): Noir/bb proof workers, circuits and their inputs.
- [Notary](notarization.md#implementation-guide): TLSNotary sessions, transcripts and attestations.
- [Assets](prefetch.md#implementation-guide): resource declarations and resolution, root Service Worker, cached bytes and pending fetches.

[ui.ts](../src/ccdp/documents/ui.ts) owns the native document UI.
[primitives.ts](../src/primitives.ts) owns shared byte and validation helpers;
[response.ts](../src/response.ts) reads bounded response bodies.
[events.ts](../src/events.ts) owns the shared operation feed and stage projection.
[json.ts](../src/json.ts) detects duplicate JSON keys in transcript parsing.
The source root exports the client-safe discovery and result API. Only the root
and `ccdp/client` are public package entrypoints; document startup remains private.

## Code conventions

Use the workspace Biome format: two spaces, single quotes and no semicolons.
`pnpm -C ts lint` also checks ceremony import/export organization;
`pnpm -C ts fmt:check` checks formatting. To apply both locally, run
`pnpm -C ts exec biome check --write --only=assist/source/organizeImports packages/ceremony`.

Separate top-level declarations and class methods with a blank line; keep related
fields together. Add JSDoc where an API has meaningful input, lifecycle, ordering,
ownership or failure constraints. Internal comments explain reasons and invariants,
especially byte preservation, concurrency and trust boundaries. Avoid restating
names or types, and keep comments adjacent to the code they explain.

The normative specs own cross-component interoperability; these guides own
implementation, deployment tooling, and qualification evidence.
Implementation guides link to code for local mechanics; stable test IDs remain in
[the requirement index](test-plan.md) and [traceability](traceability.md). Biome checks
mechanical style; comment usefulness and declaration spacing remain review concerns.

Keep fixtures beside the owning tests using a `.fixture.*` suffix. The Google
circuit fixture is shared with browser qualification; the canonical attestation
fixture lives with its decoder tests. Package contents exclude these fixture files.
