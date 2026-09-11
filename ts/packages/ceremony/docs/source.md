# Ceremony source

[Package architecture](architecture.md) defines the boundaries and public
exports. The guides below describe each module and its contract.

- [CCDP client](client.md#implementation-guide): configuration and caller-side ceremony state.
- [CCDP](protocol.md#implementation-guide): message codecs and [document entrypoints](documents.md#implementation-guide).
- [Platforms](pipelines.md#implementation-guide): authorization, versioned proofs and pipelines.
- [Barretenberg](proving.md#implementation-guide): Noir/bb proof workers, circuits and their inputs.
- [Notary](notarization.md#implementation-guide): TLSNotary sessions, transcripts and attestations.
- [Assets](prefetch.md#implementation-guide): resource declarations and resolution, root Service Worker, cached bytes and pending fetches.

[ui.ts](../src/ui.ts) owns the native document UI. [primitives.ts](../src/primitives.ts) and
[response.ts](../src/response.ts) contain shared encoding and bounded-response helpers.
[json.ts](../src/json.ts) detects duplicate JSON keys; [progress.ts](../src/progress.ts)
accounts for work across platform pipelines and proving.
The source root exports the client-safe platform catalog, not browser entrypoints.
