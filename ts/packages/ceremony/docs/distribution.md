# Static CCDP distribution build

The [Distribution specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md) owns public
resource and response contracts. This guide describes how the package builds
and serves them. Routes and private inputs belong to
[CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md#documents-and-routes), not to a second route catalog here.

The host consumes generated files and SWS configuration. It does not compile,
resolve archives, select platforms, or fetch assets per browser request.
[Build commands](overview.md#build-and-serve) and the
[compiler map](build.md) are the starting points.

The code-owned policies in `src/ccdp/headers.ts` and `build/profiles.ts` generate
response headers for each emitted resource. Execution workers have their own
CSP and COEP; blob workers inherit the creator's policy. All asset fetchers
admit `'self'`, and permitted HTTP/WS loopback sources retain arbitrary ports.
External CRS origins/ranges come from the same declarations used at runtime,
not a manually duplicated CSP list. Callback contains only bundled executable
code and the configuration marker; the Bridge inserts data, not code.

## Static artifact build

`@libid/ceremony` owns a platform-neutral artifact pipeline. It produces one
graph of local public paths, response bodies, response profiles, and declared
external asset requests, then
materializes it as static files and a Static Web Server configuration. The
graph has no separate serialized format or browser-visible manifest.

### Source declarations

Shared integrations such as `barretenberg` and `notary` each define
their resources once in a data-only `*.assets.ts` module. The package's internal
`assets` helper provides declarations and URL resolution; downloading,
archive extraction, and wildcard matching run only in the artifact build.

#### Archives

```ts
// Data-only declaration; the actual owner is notary/notary.assets.ts.
import * as assets from '../assets/index.js'

const tlsnRelease = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.3.0-rc.3/tlsn-wasm-0.3.0-rc.3.tar.gz',
  'tlsn/v0.3.0-rc.3-csp1',
)

const headers = {
  ...assets.headers.immutable,
  ...assets.headers.javascript,
}
export const wasmJs = tlsnRelease.member('tlsn_wasm.js', headers)
export const spawnJs = tlsnRelease.member(
  'snippets/web-spawn-*/js/spawn.js',
  { ...headers, ...assets.headers.executionWorker },
)
```

`archive(source, mount)` declares a build-time archive source: an HTTPS URL
or a local filesystem path. Relative local paths resolve from the ceremony
package root; absolute local paths are accepted. The build reads the archive
once and registers **all regular-file members** beneath
`/ccdp/assets/<mount>/`, preserving their archive-relative paths. It does not
flatten directories, strip release-directory prefixes, or rename members.
Relative imports and worker references within the archive therefore continue
to resolve. The source location is never a browser fetch URL.

`member(path, headers)` selects one file and declares its HTTP **response**
headers. Paths are relative to the archive root and may contain `*` within
directory components; `*` does not cross `/`. The final filename is exact.
The build requires exactly one regular-file match: zero or multiple matches
fail instead of selecting the first. If the example matches
`snippets/web-spawn-a1b2/js/spawn.js`, its resolved path is
`/ccdp/assets/tlsn/v0.3.0-rc.3-csp1/snippets/web-spawn-a1b2/js/spawn.js`, never the glob
or an alias. Mounted members use the immutable asset response profile with
their media type; member headers specialize that profile, including the
execution-worker policy where needed, without weakening the HTTP contract.
Conflicting declarations for the same public path fail the build.

Mounts and member paths cannot escape their roots. Absolute archive paths,
parent traversal, links, or duplicate entries that would overwrite files fail
the build. A local source is still subject to immutable publication: changing
its bytes requires a new public path, not overwriting an existing mount.

`assets.resolve(asset)` synchronously returns the absolute runtime URL. For
archive members the build supplies the exact matched public path, and runtime
resolution uses the executing document or worker's CCDP origin, not the source
URL or the JavaScript bundle's directory. Browser bundles contain only the
resolved metadata and the small URL resolver: no archive library, filesystem
access, wildcard lookup, runtime manifest request, or extraction step. Build
plumbing is internal; callers neither copy generated filenames nor await URL
resolution.

Execution code imports the declared member and resolves its URL. The build
imports the data-only declarations above without invoking `resolve()` or
requiring a browser origin:

```ts
// notarization — execution code
import * as assets from '../assets/index.js'
import { wasmJs } from './notary.assets.js'

const wasmJsUrl = assets.resolve(wasmJs)
// On https://lib.id: https://lib.id/ccdp/assets/tlsn/v0.3.0-rc.3-csp1/tlsn_wasm.js
```

#### External requests

```ts
// barretenberg/barretenberg.assets.ts — data-only declaration
import * as assets from '../assets/index.js'

export const g1 = assets.external(
  'https://crs.aztec-cdn.foundation/g1_compressed.dat',
  { range: `bytes=0-${SRS_SIZE * 32 - 1}` },
)
```

Execution code uses the same resolver:

```ts
// barretenberg — execution code
import * as assets from '../assets/index.js'
import { g1 } from './barretenberg.assets.js'

assets.resolve(g1)
// https://crs.aztec-cdn.foundation/g1_compressed.dat
```

`external(url, options?)` retains an absolute HTTPS URL and optional request
parameters. `range` is an HTTP **request** `Range` value, not a response header
or URL suffix; omitting it requests the full resource. The build validates the
declaration but does not download, copy, extract, or emit a body, local route,
or response profile for it. Generated CSP admits the declared fetch origin.
`resolve()` returns the original URL unchanged and performs no fetch; the
declaration retains the request parameters for Prefetch and the actual loader.
Their requests use the same URL and range, including single-flight/cache keys.
Different ranges cannot silently become the same resource because their URLs
are equal. No separate runtime resolver or explicit `mode` argument is needed.

External availability, readable CORS, range behavior, and the loader's real
request set remain release-qualification checks, not ordinary build downloads.
Current external resources are CRS data, not executable scripts or workers.
Location is code-owned, not application input or a deployment override API.

#### Header policy and generated metadata

Headers have two owners; resource declarations supply only policy:

| Kind | Examples | Owner |
|---|---|---|
| Declared policy | MIME (`Content-Type`), cache lifetime, CSP rules, isolation and framing headers | Code-owned, reusable header groups extended by the resource declaration. |
| Generated response metadata | `ETag`, `Last-Modified`, `Content-Length`, `Content-Encoding`, `Content-Range` | Supplied by SWS from the build's emitted files and the selected response, never handwritten in a declaration. |

The `assets` module exports shared policy groups as ordinary header records:

| Group | Shared policy |
|---|---|
| `headers.immutable` | Immutable asset caching, `nosniff`, and same-origin CORP. |
| `headers.javascript`, `headers.wasm`, `headers.json` | The corresponding exact MIME header. |
| `headers.document` | Common document CSP, framing, referrer, and `nosniff` rules. |
| `headers.executionWorker` | The common execution-worker CSP and JavaScript policy. |
| `headers.dip`, `headers.isolated` | The distinct DIP and COOP/COEP isolation policies from the Distribution specification. |

Resource declarations and protocol response profiles reuse these groups, then
extend them with ordinary object spread and explicit fields:

```ts
const wasm = tlsnRelease.member('tlsn_wasm_bg.wasm', {
  ...assets.headers.immutable,
  ...assets.headers.wasm,
})
```

An explicit field replaces that header; there is no implicit concatenation or
deep-merge policy language. The build checks the final policy against the Distribution specification. It rejects conflicting case-insensitive header names and any
handwritten generated-response metadata. Members not selected
with `member()` receive the shared immutable policy and MIME for their file
type; execution-worker exceptions must be declared explicitly.

CSP remains declared policy even though its executable hashes and concrete
resource origins are filled from the emitted code and resource graph. There
is one source for these rules, not a second copy in deployment templates.

The build produces the original and optional Brotli/gzip bodies; SWS derives their
HTTP metadata when serving them. Length and encoding must match the selected
body, including range responses. Do not emit fixed metadata overrides into
path-policy rules or add a custom serving layer to reproduce SWS's behavior.
There is no checked-in checksum list or new runtime integrity check.

#### Profile composition

Platform/version asset leaves import shared declarations and add their own
requirements, for example:

```ts
// platforms/x/1/x.assets.ts
import { proofAssets } from '../../../barretenberg/barretenberg.assets.js'
import { notaryAssets } from '../../../notary/notary.assets.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../../../barretenberg/circuits/bearer_link/bearer_link.assets.js'

export const assets = [...proofAssets, ...notaryAssets, bearerCircuit, bearerVerificationKey]
```

Other shared toolchain dependencies compose the same way. A circuit shared by
multiple platforms likewise has one declaration, not a copy in each platform.
`platforms/platforms.assets` maps supported platform/version pairs to these composed
sets. It contains resource metadata only, not client or prover implementation
imports. Prefetch consumes that catalog, not the build table containing the
document entrypoints. The build collects shared references once while
preserving membership in every profile that needs them. Both Prefetch and
actual dependency loaders receive the same resolved resources; neither keeps
another filename or URL list. The catalog is bundled metadata, not a fetched
manifest or an independent platform-support registry.
Mounting an archive makes every member servable; it does not prefetch them all.
Each selected profile includes the members it actually loads, including nested
scripts/workers. Shared declarations and overlapping profiles reuse the same
mounted files and URL/range-keyed fetches.

The build resolves `crsPath` to the common base of the CRS entries, currently
`https://crs.aztec-cdn.foundation`. Remaining CRS requests and any native
fallback requests belong to the bb integration's declarations; their exact
paths, ranges, and sizes are defined in [Proving](proving.md#dependency-asset-resolution).

Local and external declarations participate in the same selected-profile
prefetch graph. Changing where an asset is served must not change its logical
role, bytes, or proving semantics. For distributed
CRS, all members retain the loader's filenames under one immutable base
directory so the same `crsPath` option selects the set.

### Protocol resources and response profiles

The build's resource table collects protocol entrypoints and the owner-defined
platform asset sets; it does not redeclare their resources. Protocol entries
have a stable public route, source entrypoint, and response profile:

```ts
import { assetsByPlatform } from './platforms/assets'

const resources = {
  callback: {
    route: '/ccdp/callback.html',
    entry: callbackEntry,
    profile: 'callback',
  },
  prefetch: {
    route: `/ccdp/v${version}/prefetch`,
    entry: prefetchEntry,
    profile: 'prefetch',
  },
  prover: {
    route: `/ccdp/v${version}/prover`,
    entry: proverEntry,
    profile: 'prover',
  },
  proverFallback: {
    route: `/ccdp/v${version}/prover/fallback`,
    entry: proverEntry,
    profile: 'proverFallback',
  },
  worker: {
    route: `/ccdp/v${version}/worker.js`,
    entry: prefetchEntry,
    profile: 'worker',
  },
  assets: assetsByPlatform,
} as const
```

The entrypoints are build-tool inputs, not output filenames. First-party
execution dependencies use ordinary imports; the build reads their emitted
graph and filenames from the compiler/bundler. It augments each profile's
resource declarations with its emitted dependency scripts for prefetch, without
importing that execution code into Prefetch or its Worker. External dependency
requests are checked against the real loaders. Renaming an internal output
requires no manual mapping change; renaming an external release member changes
only its owner-defined pin. No generated-source scrape or deployment template
maintains another copy.

One response-profile table is the executable source for the policies under
[HTTP contract](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md#http-contract):

```ts
const responseProfiles = {
  callback: callbackResponseProfile,
  prefetch: prefetchResponseProfile,
  prover: proverResponseProfile,
  proverFallback: proverFallbackResponseProfile,
  worker: workerResponseProfile,
  asset: immutableAssetResponseProfile,
  executionWorker: immutableExecutionWorkerResponseProfile,
} as const
```

The Callback entry bundles the closed implementation set once across supported
CCDP versions, sharing dependencies where possible. The same build selection
drives the bundled dispatch table and corresponding versioned resources. All
implementations share the unversioned deployment-input contract; the Bridge
maintains no CCDP version table. Retiring a version after its compatibility
window removes its implementation, not the generic
local unsupported-version screen, and retains no transport just to report that
retirement. Its configuration marker is a build-owned constant shared with
the bridge composition contract, not a generated filename or per-version
script URL. Callback dependencies must be inlined, even where other documents
can use immutable chunks. A missing implementation or split Callback entry
dependency fails artifact generation.

Profiles compose the shared [declared header policy](#header-policy-and-generated-metadata),
with no generated filenames or representation metadata. The build fills CSP
hashes, generated resource URLs, and external asset origins. The shared Prover
and TLSNotary-worker policies declare their required network scheme sources;
no client-specific notary setting participates in the build. It does not parse
this Markdown or ask SWS to reconstruct policy.

### Generation

Across the supported CCDP versions, the pipeline:

1. gives the declared entrypoints to the compiler/bundler;
2. reads emitted filenames and dependency edges from its output API;
3. materializes local dependencies, mounting complete archives and resolving
   each member selector to its exact path and response headers; gzip-packed
   `.wasm` bodies are decoded before publication. External declarations retain
   their URLs and request parameters without a download;
4. resolves each platform/version's prefetch and loader locations from those
   declarations and emitted dependencies, then renders versioned protocol bodies
   and the aggregate Callback artifact using the paths and response profiles;
5. emits Brotli and gzip sidecars for each unencoded public body, each only
   when smaller, using standard compression implementations; and
6. validates local graph completeness and the declared external request set
   before replacing the generated output.

The pipeline rejects a missing body, unindexed dependency, malformed external
pin, mutable asset path, sidecar which does not decode to the original, or
partial graph. Pinned source releases are cached by immutable identity rather
than fetched on every build. The [dependency upgrade checks](proving.md#dependency-asset-resolution)
detect changed upstream loader requests; live CDN qualification runs before
release, not on every local build.

## Portable distribution

[Static Web Server v3](https://static-web-server.net/v3/) (SWS) is the sole
serving dependency. It is an open-source static file server with a
[TOML configuration](https://static-web-server.net/v3/configuration/file),
[path-matched response
headers](https://static-web-server.net/v3/features/custom-http-headers), ETags,
range requests, and [rootless multi-architecture container
images](https://static-web-server.net/v3/features/docker). No CCDP-specific
server or SWS plugin exists.

### Serving ownership

The build produces files and configuration, not an HTTP server. SWS owns file
streaming, GET/HEAD handling, conditional requests, range responses, generated
response metadata, and configured static error pages. No TypeScript middleware
or preview server reimplements those semantics. The build retains resource
selection, safe extraction, bundling, declared security/cache policy, and
publication checks.

SWS's native [ETags and conditional requests](https://static-web-server.net/v3/features/etag)
remain enabled independently of automatic cache-policy defaults. Its weak
validator uses file modification time and size, not a content hash. Changed
bytes at a stable protocol URL must therefore receive changed file metadata,
including when the byte length is unchanged. Preserve that distinction through
container assembly; normalizing different releases to one fixed timestamp can
otherwise preserve a stale validator. Qualification checks the served result,
not a custom ETag algorithm.

The build creates `.br` and `.gz` sidecars using standard compression tooling; SWS's
[pre-compressed-file serving](https://static-web-server.net/v3/features/compression-static)
owns negotiation, `Vary`, and representation selection. This does not enable
request-time compression or move archive extraction into the server. Gzip
provides a compressed response when the browser does not advertise Brotli,
including WebKit on localhost HTTP. Prefetch and execution use the same
unencoded resource URL and cache the decoded body. Sidecar paths may not
collide with retained immutable resources.

### Static layout and configuration

Build the portable distribution with:

```sh
pnpm --filter @libid/ceremony build:ccdp-artifacts -- --out-dir <directory>
```

It replaces the output directory only after validating the complete graph.
A typical output is:

```text
<directory>/
├── public/
│   ├── ccdp/callback.html
│   ├── ccdp/v{CCDPVersion}/prefetch.html
│   ├── ccdp/v{CCDPVersion}/prover.html
│   ├── ccdp/v{CCDPVersion}/prover-fallback.html
│   ├── ccdp/v{CCDPVersion}/worker.js
│   ├── ccdp/assets/...
│   └── 404.html
└── sws.toml
```

`public/` contains only the validated public graph. `sws.toml` remains outside
that root and is the only deployment manifest. It is generated rather than
operator-edited and starts from this fixed baseline:

```toml
[general]
host = "::"
# Port is selected by deployment CLI/env; SWS defaults to 8787.
root = "/home/sws/public"
page404 = "/home/sws/public/404.html"
cache-control-headers = false
etag = true
compression = false
compression-static = true
security-headers = false
directory-listing = false
redirect-trailing-slash = false
health = false
text-charset = false
```

No SPA fallback is configured. Exact SWS
[internal rewrites](https://static-web-server.net/v3/features/url-rewrites)
map protocol routes to their emitted files, without `redirect`, a Location
header, or another browser request. For example, the build generates:

```toml
[[advanced.rewrites]]
source = "/ccdp/v1/prefetch"
destination = "/ccdp/v1/prefetch.html"

[[advanced.rewrites]]
source = "/ccdp/v1/prover"
destination = "/ccdp/v1/prover.html"

[[advanced.rewrites]]
source = "/ccdp/v1/prover/fallback"
destination = "/ccdp/v1/prover-fallback.html"
```

The filenames above are illustrative build outputs, not new protocol routes
or a second hand-maintained mapping. The resource graph supplies the rewrite
destinations. Versioned documents reject direct navigation to their emitted
`.html` paths during bootstrap; only the CCDP entry paths execute the protocol.
Callback, Worker, and asset paths already matching their files need no rewrite.
Unknown routes do not match a catch-all rewrite.

The generator emits ordered `advanced.headers` rules from the shared policy
groups: common defaults first, resource-specific overrides afterwards. SWS's
last matching value wins for each header. Intentional overlap is allowed; no
algorithm partitions the asset tree into disjoint header patterns. An override
replaces a complete header value, including CSP, rather than appending another
policy header.

SWS evaluates these rules after rewriting. Generate matches from the same
route-to-file graph, accounting for the pinned SWS version's path matching,
and qualify the effective response at the public URL. Every resource must
receive its declared media, cache, isolation, framing, CORS, CSP, and
`Service-Worker-Allowed` policy. In particular, generic asset rules must not
erase execution-worker policy, and the two Prover responses must retain their
distinct isolation headers. Reject missing or incorrect effective policy,
unrepresented files, or configuration weakening the [HTTP contract](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md#http-contract),
not overlapping rules merely because they overlap.

### Container and qualification

The checked-in container recipe is fixed apart from the SWS image digest:

```dockerfile
FROM ghcr.io/static-web-server/static-web-server@sha256:<pinned-v3-alpine-digest>
COPY --chown=sws:sws public/ /home/sws/public/
COPY --chown=sws:sws sws.toml /etc/sws.toml
ENV SERVER_CONFIG_FILE=/etc/sws.toml
```

Release automation pins one qualified SWS v3 image by digest, builds this image from the
generated directory, and verifies the served route, header, cache, method, and
404 contracts before publication. The container serves HTTP internally; its
deployment terminates public HTTPS at an ordinary container ingress, load
balancer, or CDN without rewriting paths, bodies, or security headers.

The resulting OCI image is the portable release artifact. A deployment may run
it on any container platform and may place a transparent CDN in front of it.
Promotion switches to the complete image atomically; the image already contains
every old protocol resource and immutable asset required by the supported
compatibility window. No startup download, mounted source directory,
request-time templating, or platform-specific manifest is required.

Local preview and browser integration tests run the same pinned SWS binary and
generated configuration as deployment, directly or through the same image.
Unit tests may use fakes for build logic, but HTTP qualification does not use a
TypeScript imitation of SWS. For example:

```sh
docker build --file <ccdp.Dockerfile> --tag libid-ccdp <directory>
docker run --rm --publish 8787:8787 libid-ccdp
```

Rebuilding it for development changes no browser protocol or response policy.
