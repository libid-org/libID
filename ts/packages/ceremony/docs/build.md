# Static CCDP build

Compiles the versioned documents and their dependency graph into a static distribution
with immutable resources and generated response policies.

Build scripts and their tests run directly with Node's
[native TypeScript support](https://nodejs.org/api/typescript.html#type-stripping):
use Node 22.18+ on the 22.x line, or Node 24+. No TS runner or compilation step is
needed. `pnpm typecheck:build` checks them with strict NodeNext resolution and
`erasableSyntaxOnly`; the package's `typecheck` includes this check.
Only type imports cross into browser modules. The build reuses the shared asset
contracts, Vite's plugin/output types and ESTree's AST types.

- [Distribution contract](distribution.md): routes, headers, source declarations and publication.
- [Build and serve](overview.md#build-and-serve): commands and Docker image.
- [Exact dependency requests](proving.md#dependency-asset-resolution): native external CRS behavior.

[distribution.ts](../build/distribution.ts) assembles and promotes the artifact;
[bundle.ts](../build/bundle.ts) records compiler dependencies. [assets.ts](../build/assets.ts) resolves
owner declarations, [release.ts](../build/release.ts) checks pinned downloads, and
[circuits.ts](../build/circuits.ts) checks circuit capacity. [profiles.ts](../build/profiles.ts)
owns response policies; [popup.ts](../build/popup.ts) integrates the optional external carrier.

The build never rehosts native external CRS resources. `test:distribution` exercises
real dependency loaders and emitted responses; set `CEREMONY_SWS_URL` to check the
actual server. [Qualification](qualification.md) separates these checks from
real consent and device evidence.
