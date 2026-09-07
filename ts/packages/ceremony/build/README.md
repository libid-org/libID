# Static CCDP build

Compiles the versioned documents and their dependency graph into a static distribution
with immutable resources and generated response policies.

- [Distribution contract](../docs/distribution.md): routes, headers, source declarations and publication.
- [Build and serve](../README.md#build-and-serve): commands and Docker image.
- [Exact dependency requests](../src/prover/docs/proving.md#dependency-asset-resolution): native external CRS behavior.

[distribution.mjs](distribution.mjs) assembles and promotes the artifact;
[bundle.mjs](bundle.mjs) records compiler dependencies. [assets.mjs](assets.mjs) resolves
owner declarations, [release.mjs](release.mjs) checks pinned downloads, and
[circuits.mjs](circuits.mjs) checks circuit capacity. [profiles.mjs](profiles.mjs)
owns response policies; [popup.mjs](popup.mjs) integrates the optional external carrier.

The build never rehosts native external CRS resources. `test:distribution` exercises
real dependency loaders and emitted responses; set `CEREMONY_SWS_URL` to check the
actual server. [Qualification](../docs/qualification.md) separates these checks from
real consent and device evidence.
