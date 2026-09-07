# Prefetch and asset cache

Owns root Service Worker registration, immutable cached response bodies and pending
fetch sharing. Pre-OAuth work warms bytes, not initialized proof or TLSNotary runtimes.

- [Prefetch and cache contract](docs/prefetch.md): dispatch acknowledgement, caching and lifecycle.
- [Dependency loaders](../prover/docs/proving.md#dependency-asset-resolution): exact native URLs and ranges.
- [Distribution graph](../../build/docs/distribution.md#source-declarations): one owner declaration per resource.

[registration.ts](registration.ts) resolves root ownership and dispatches selected
profiles. [worker.ts](worker.ts) composes popup continuity with [cache.ts](cache.ts).
The browser/worker entrypoint lives in [ccdp/documents/prefetch.ts](../ccdp/documents/prefetch.ts).
