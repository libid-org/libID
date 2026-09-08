# Static CCDP build

Compiles the versioned documents and their dependency graph into a static distribution
with immutable resources and generated response policies.

Build scripts and their tests run directly with Node's
[native TypeScript support](https://nodejs.org/api/typescript.html#type-stripping):
use Node 22.18+ on the 22.x line, or Node 24+. No TS runner or compilation step is
needed. `pnpm typecheck:build` checks them with strict NodeNext resolution and
`erasableSyntaxOnly`; the package's `typecheck` includes this check.
The build imports browser-safe header constants and types. The build reuses the shared asset
contracts, Vite's plugin/output types and ESTree's AST types.

- [Distribution contract](distribution.md): routes, headers, source declarations and publication.
- [Build and serve](overview.md#build-and-serve): commands and Docker image.
- [Exact dependency requests](proving.md#dependency-asset-resolution): native external CRS behavior.

[distribution.ts](../build/distribution.ts) assembles and promotes the artifact;
[bundle.ts](../build/bundle.ts) records compiler dependencies. [assets.ts](../build/assets.ts) resolves
owner declarations, [archive.ts](../build/archive.ts) safely reads archives, and [release.ts](../build/release.ts) caches declared HTTPS downloads, and
[circuits.ts](../build/circuits.ts) checks circuit capacity. [profiles.ts](../build/profiles.ts)
composes protocol policies from [shared headers](../src/ccdp/headers.ts); [sws.ts](../build/sws.ts) emits files, Brotli sidecars and native SWS configuration; [popup.ts](../build/popup.ts) integrates the optional external carrier.

The build never rehosts native external CRS resources. `test:distribution` exercises
real dependency loaders and emitted responses; set `CEREMONY_SWS_URL` to check the
actual server. [Qualification](qualification.md) separates these checks from
real consent and device evidence.

Resources use `assets.archive(source, mount).member(selector, headers)` or
`assets.external(url, requestOptions)`. Standalone installed WASM uses
`assets.file('npm:<package>/<path>', immutablePath, headers)`; its package integrity
comes from the workspace lockfile. An archive source may also be a package-relative
or absolute local archive path. Source selection stays in its owning declaration.
`resolve()` works synchronously in execution code; the build erases source locations
and header arguments from browser resource construction using compiler ASTs.

The archive reader uses the build-only `tar` dependency for format parsing; it never
extracts to paths selected by an archive. It rejects traversal, links, duplicates,
overlapping mounts and output/sidecar collisions before promotion.
