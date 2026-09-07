# Ceremony source

[Package architecture](../docs/architecture.md) defines the boundaries and public
exports. Each major module has a local guide and links to its contract.

- [Client](client/README.md): configuration and caller-side ceremony state.
- [CCDP](ccdp/README.md): message codecs and [document entrypoints](ccdp/documents/README.md).
- [Platforms](platforms/README.md): authorization, versioned proofs and pipelines.
- [Prover](prover/README.md): proof workers and [notarization](prover/notarization/README.md).
- [Prefetch](prefetch/README.md): root Service Worker, cached bytes and pending fetches.

[ui.ts](ui.ts) owns the native document UI. [primitives.ts](primitives.ts) and
[response.ts](response.ts) contain shared encoding and bounded-response helpers.
The source root exports the client-safe platform catalog, not browser entrypoints.
