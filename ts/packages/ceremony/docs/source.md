# Ceremony source

[Package architecture](architecture.md) defines the boundaries and public
exports. The guides below describe each module and its contract.

- [Client](client.md#implementation-guide): configuration and caller-side ceremony state.
- [CCDP](protocol.md#implementation-guide): message codecs and [document entrypoints](documents.md#implementation-guide).
- [Platforms](pipelines.md#implementation-guide): authorization, versioned proofs and pipelines.
- [Prover](proving.md#implementation-guide): proof workers and [notarization](notarization.md#implementation-guide).
- [Prefetch](prefetch.md#implementation-guide): root Service Worker, cached bytes and pending fetches.

[ui.ts](../src/ui.ts) owns the native document UI. [primitives.ts](../src/primitives.ts) and
[response.ts](../src/response.ts) contain shared encoding and bounded-response helpers.
The source root exports the client-safe platform catalog, not browser entrypoints.
