# CCDP Distribution

This document defines the static browser resources and proving assets required
by [CCDP](../src/ccdp/documents/docs/documents.md#documents-and-routes). CCDP owns the protocol routes,
fragments, roles, navigations, and versions; this document owns their HTTP,
build, and deployment contract.

## Distribution boundary

One CCDP Distribution is served from one canonical HTTPS `ccdpOrigin`. Explicit
loopback development is the only HTTP exception. It contains:

- every protocol resource for each supported CCDP version; and
- their bundled JavaScript, workers, WASM, circuits, and libID-owned assets.

The resource graph distinguishes distributed assets from external assets.
Browsers prefetch and fetch external resources at their declared absolute
URLs; the static build does not download or mirror them. The current bb.js CRS
resources use that mode with the native Aztec URLs. The exact dependency
requests and cache behavior are defined in
[PROVING.md](../src/prover/docs/proving.md#dependency-asset-resolution).

The OAuth Bridge separately serves ceremony configuration, the registered
callback shell, and enabled confidential platform endpoints. Requests to the
OAuth Platform, OAuth Bridge, Notary Service, and public platform APIs are
protocol traffic rather than CCDP assets.

The Distribution may be the canonical libID release or an operator-selected
replacement. Replacing it changes the code-supply-chain authority for Callback
and proof generation.

One Distribution may serve any number of independently operated OAuth Bridges.
It does not enumerate or register them: each Bridge selects a `ccdpOrigin`,
which serves the same public resources to all of them. A Bridge advertises only
platform/version pairs present in its selected Distribution; no shared
deployment system is required.

## HTTP contract

The Distribution is static and request-invariant. It sets no cookies, serves no
unrelated same-origin application API, and performs no request-time compilation,
templating, source resolution, archive extraction, or remote asset fetch.

### Protocol resources

The Distribution exposes the exact versioned
[resources](../src/ccdp/documents/docs/documents.md#documents-and-routes) defined by CCDP. Their fragments,
roles, and execution contexts remain CCDP rules.

Prefetch and Prover contain their clearing bootstrap and entry code
directly, with no browser-visible manifest or second entry-script request. They
may load implementation-private immutable chunks and expose only an empty mount
point to package-owned presentation. Callback remains a separate ES module
because the OAuth Bridge shell loads the version selected from OAuth `state`.

Each supported path has one decoded representation and response policy.
`Accept-Encoding` may select only the Brotli transfer representation defined
below. Conditional caching may return `304 Not Modified`; otherwise query
values, request headers, `Origin`, `Referer`, cookies, and user agent cannot
select different bytes, policy, embedded configuration, or implementation. A
nonempty query may receive the same static resource, but its clearing bootstrap
rejects before protocol execution. Only `GET` and `HEAD` are defined. Unknown
paths and versions return an inert failure without fallback or redirect; other
methods execute no CCDP code.

The not-found response is static HTML containing no script, style, link, form,
redirect, or protocol data.

Versioned protocol resources use `Cache-Control: no-cache` and an ETag so one
path may receive compatible implementation updates. A breaking protocol change
publishes a new CCDP-version path.

All protocol resources send their exact media type and
`X-Content-Type-Options: nosniff`. Top-level documents additionally send
`Referrer-Policy: no-referrer` and are not frameable. Document CSP begins with
`default-src 'none'`, `object-src 'none'`, `base-uri 'none'`,
`form-action 'none'`, and `frame-ancestors 'none'`; admits only the exact
build-generated entry code, resources, and network sources needed by that
document; and uses neither JavaScript `'unsafe-inline'` nor `'unsafe-eval'`.
Package-owned UI uses `style-src 'unsafe-inline'` with no external stylesheet
source or styling customization input.

| Resource | Form | Additional response contract |
|---|---|---|
| Callback | ES module loaded by the OAuth Bridge shell | `text/javascript; charset=utf-8`, noncredentialed `Access-Control-Allow-Origin: *`, and `Cross-Origin-Resource-Policy: cross-origin`. The OAuth Bridge owns the containing document and its CSP. |
| Prefetch | top-level non-isolated HTML | `Cross-Origin-Opener-Policy: unsafe-none` and no COEP. Script/worker sources remain same-origin; `connect-src` admits local assets and the pinned Aztec CRS origins. |
| Prover | top-level HTML | `Document-Isolation-Policy: isolate-and-require-corp`, `Cross-Origin-Opener-Policy: unsafe-none`, and no COEP. |
| Prover isolation fallback | top-level HTML at `/ccdp/v{CCDPVersion}/prover/fallback` | `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Same Prover entrypoint, fragment contract, and non-isolation response rules. |
| Worker | module Service Worker JavaScript | `text/javascript; charset=utf-8` and `Service-Worker-Allowed: /`. Prefetch registers it with `scope: '/'`; it remains compatible with every live CCDP version and passes unrelated requests through unchanged. Code is same-origin; `connect-src` also admits the pinned Aztec CRS origins for asset caching. |

For any resource whose generated Brotli representation is smaller, the
Distribution serves that representation when the request admits `br` and the
original otherwise. A compressed response keeps the original media type and
response profile, adds `Content-Encoding: br`, and includes
`Vary: Accept-Encoding`. Decoding it produces the exact original bytes. No
runtime compression or other negotiated representation exists.

Both Prover responses close script and worker sources to the build-generated
same-origin graph and toolchain-required `blob:` workers. Asset fetches are
not restricted to the CCDP origin: their `connect-src https:` admits bb.js's
Aztec CRS downloads as well as validated third-party OAuth Bridges. The build
additionally pins the Notary Service's exact WebSocket origin.

Every context which fetches or prefetches CRS, including the Service Worker
and dedicated proof workers, admits both `https://crs.aztec-cdn.foundation`
and `https://crs.aztec-labs.com` in `connect-src` for the current native loader,
unless already covered by its HTTPS source. These sources are generated from
the external request declarations, not a second manually maintained list.
They are fetch permissions, not remote JavaScript/worker
permissions. The requests use noncredentialed CORS and must remain readable
under both Prover isolation responses. No `no-cors` or opaque-response bypass
is allowed. The CDN's availability and CORS policy are external dependencies,
covered by release qualification rather than headers set by this Distribution.

Every context that compiles WASM, including dedicated proof and TLSNotary
workers, includes `script-src 'wasm-unsafe-eval'` alongside its code sources.
This permits WASM compilation, not JavaScript string evaluation. External worker
scripts have their own generated CSP; they do not rely on the document's CSP.
Blob workers inherit their creator's policy. Worker profiles admit only their
required script, asset, and protocol connections, and `worker-src` admits
same-origin or `blob:` children only for workers that spawn them. The Service
Worker only caches bytes and keeps ports: it needs no WASM compilation permission.

Each request-invariant Prover response supports multiple platform profiles and
arbitrary canonical HTTPS OAuth Bridges. CSP cannot express a runtime-selected
exact Bridge origin, so its HTTPS connection class is not per-Bridge
compartmentalization. Prover derives GitHub's fixed token route only from the
validated `redirectUri` frozen by the Application; no message supplies another
Bridge endpoint. Compromised Prover code can use every network class admitted
by the response.

### Prover isolation

CCDP has one logical [Prover](../src/ccdp/documents/docs/documents.md#prover-get-prover), reached by ordinary
`connection.navigate(proverUrl, fragment)`. The Distribution supplies two static responses
for that participant, not another protocol step or application-level choice.

The primary response requests
[Document-Isolation-Policy](https://wicg.github.io/document-isolation-policy/)
without severing the opener. Its entrypoint calls `PopupConnection.accept`
with `isolationFallbackUrl` set to the same-origin
`/ccdp/v{CCDPVersion}/prover/fallback`. The fallback embeds that same entrypoint
and supplies the same option. The popup package establishes the carrier,
checks isolation before exposing connection readiness or dispatching
application messages, and performs any necessary same-origin replacement.
If the fallback is still unisolated, acceptance fails rather than navigating
again. Ceremony code neither detects browsers nor implements the transition.

Both responses use the Prover fragment grammar, including its private
OAuth-return fields. Their first bootstrap captures and clears the fragment
before rendering, imports, storage access, or reporting errors. It supplies
the retained `URLSearchParams` snapshot to popup construction through the
package's fragment-capture API, so URL clearing cannot erase fallback input.
`isolationFallbackUrl` contains no fragment; automatic replacement preserves
the snapshot without an override. The final response captures and clears it
again. Neither response parses platform-specific return fields before
`AppStartProver`, sends the captured return to Application, or puts it into
Worker state, signaling, logs, or telemetry.

Both paths resolve the root-scope Worker registration installed by Prefetch.
Resolve its exact `/` scope, not the longest scope matching the current page
or a registration identified only by script URL. A stale `/ccdp/v1/`
registration may use the same script URL and must not replace the root choice.
This lets the popup package preserve a MessagePort internally while the same
Worker's asset flights and caches remain available to the final Prover.
Before connection readiness the entrypoint performs no proving or CCDP
delivery. It registers its handlers and awaits readiness before emitting
`ProverReady`. Isolation, shared memory, and worker support are required;
there is no single-threaded or unisolated proving mode.

Successful DIP isolation avoids an extra navigation. Otherwise the package
uses the COOP/COEP response without another user action, second window, or
concurrent Prover. Neither path repairs an opener already severed by an OAuth
Platform; that remains the popup connection's independent fallback-carrier
case.

DIP adoption can eventually remove the replacement: track the
[Chromium documentation](https://developer.chrome.com/blog/document-isolation-policy),
[Mozilla position](https://github.com/mozilla/standards-positions/issues/1074),
[Firefox implementation](https://bugzilla.mozilla.org/show_bug.cgi?id=2063367),
and [WebKit position](https://github.com/WebKit/standards-positions/issues/399).
Embedded proving is a separate possible evolution, not part of this top-level
Prover contract.

### Proving assets

`GET /ccdp/assets/*` is the Distribution's static proving-resource namespace,
not a CCDP API or versioned protocol route. Locally served proving resources
other than the versioned protocol resources resolve there; Aztec CRS requests
retain their upstream URLs. CCDP
assigns no structure to the suffix: versioned code pins each exact path, while
protocol code neither enumerates nor parses the namespace.

Each asset response:

- has a canonical path with no query, fragment, mutable alias, or redirect;
- serves one immutable byte sequence with its exact media type and `nosniff`;
- uses `Cross-Origin-Resource-Policy: same-origin`; and
- uses `Cache-Control: public, max-age=31536000, immutable`.

The ceremony build pins every platform/version circuit, shared notarization
resource, Noir and bb.js dependency, worker, WASM, external CRS request, and SRS size.
Requests, fragments, messages, and application inputs cannot add or replace
them. The Distribution receives no asset-source configuration and exposes no
catalog.

The Distribution contains every local path referenced by its code. Browsers
never list the asset tree or trigger server-side archive extraction or remote
fetch. bb.js JavaScript is bundled into these artifacts, not imported from a
CDN at runtime. Its supported `wasmPath` option selects the emitted WASM;
the integration also always supplies `crsPath` from the resolved CRS resources.
The current unpatched browser loader ignores it, so that declaration still
selects native Aztec hosting. A patched dependency must pass the custom-path
qualification before the build may distribute CRS locally. No source rewrite,
global-fetch URL substitution, or server-side proxy is required.
Prefetch uses the same resolved resources as execution in either mode.

### Publication and compatibility

Activation is asset-complete: every immutable resource referenced by an updated
protocol resource or Worker is retrievable with its final bytes and response
metadata before that update becomes reachable.
The external Aztec request set is qualified before promotion; CDN availability
cannot be made atomic with local deployment, and a later outage still fails
proving if no usable cache is present.

An unchanged asset retains its URL across compatible releases. Changed bytes or
execution-relevant metadata receive a new immutable URL, and old URLs remain
available while any live ceremony, supported CCDP implementation, platform
profile, or compatibility window may reference them. Runtime content hashing is
not required; release-qualified, content-addressed, and build-generated
immutable paths all satisfy this contract.

Asset revisions change `CCDPVersion` or `PlatformCeremonyVersion` only when
their observable protocol or proof semantics change.

## Static artifact build

`@libid/ceremony` owns a platform-neutral artifact pipeline. It produces one
graph of local public paths, response bodies, response profiles, and declared
external asset requests, then
materializes it as static files and a Static Web Server configuration. The
graph has no separate serialized format or browser-visible manifest.

### Source declarations

The build's resource table collects protocol entrypoints and the owner-defined
platform asset sets; it does not redeclare their resources. Protocol entries
have a stable public route, source entrypoint, and response profile:

```ts
import { assetsByPlatform } from './platforms/assets'

const resources = {
  callback: {
    route: `/ccdp/v${version}/callback.js`,
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

Shared integrations such as `prover/bb` and `prover/notarization` each define
their resources once in a data-only `assets` module. Each declaration owns its
exact source URL or pinned release member, request parameters, and mode.
Platform/version asset leaves import these shared declarations and add their
own requirements, for example:

```ts
// platforms/x/1/assets.ts
import { resources as bb } from '../../../prover/bb/assets'
import { resources as notarization } from '../../../prover/notarization/assets'
import { circuit } from './circuit'

export const resources = [...bb, ...notarization, circuit]
```

Other shared toolchain dependencies compose the same way. A circuit shared by
multiple platforms likewise has one declaration, not a copy in each platform.
`platforms/assets` maps supported platform/version pairs to these composed
sets. It contains resource metadata only, not client or prover implementation
imports. Prefetch consumes that catalog, not the build table containing the
document entrypoints. The build collects shared references once while
preserving membership in every profile that needs them. Both Prefetch and
actual dependency loaders receive the same resolved resources; neither keeps
another filename or URL list. The catalog is bundled metadata, not a fetched
manifest or an independent platform-support registry.

The build resolves `crsPath` to the common base of the CRS entries, currently
`https://crs.aztec-cdn.foundation`. Remaining CRS requests and any native
fallback requests belong to the bb integration's declarations; their exact
paths, ranges, and sizes are defined in PROVING.md rather than duplicated here.

| Mode | Build output | Browser use |
|---|---|---|
| `distributed` (default) | Compile, copy, or download the pinned source into the static output and resolve its local URL and response profile. | Prefetch and execution use that emitted URL. |
| `external` | Retain the declared absolute HTTPS URL and request parameters; emit no asset body, route, or response profile for it. | Prefetch and execution fetch that URL directly under CORS; generated CSP admits its origin. |

Both modes participate in the same selected-profile prefetch graph. Location
and mode are deployment policy controlled by the code-owned declaration; no
deployer override input is defined. They are not application inputs or runtime
endpoints. External entries do not request a network download during ordinary artifact generation;
release qualification checks their availability. Current external entries are
CRS data, not executable scripts or workers. Changing where an asset is served
must not change its logical role, bytes, or proving semantics. For distributed
CRS, all members retain the loader's filenames under one immutable base
directory so the same `crsPath` option selects the set.

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
[HTTP contract](#http-contract):

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

Profiles contain fixed isolation, cache, framing, media-type, and CSP rules but
no generated filenames. The build fills body-dependent values such as inline
script hashes, generated resource URLs, external asset origins, and the
build-pinned Notary Service origin. It does not parse this Markdown or ask SWS
to reconstruct policy.

### Generation

For each supported CCDP version, the pipeline:

1. gives the declared entrypoints to the compiler/bundler;
2. reads emitted filenames and dependency edges from its output API;
3. materializes `distributed` dependencies under immutable paths and retains
   `external` request URLs without downloading their bodies into the output;
4. resolves each platform/version's prefetch and loader locations from those
   declarations and emitted dependencies, then renders protocol bodies using
   the paths and response profiles;
5. emits a Brotli sidecar for each unencoded public body only when it is
   smaller; and
6. validates local graph completeness and the declared external request set
   before replacing the generated output.

The pipeline rejects a missing body, unindexed dependency, malformed external
pin, mutable asset path, sidecar which does not decode to the original, or
partial graph. Pinned source releases are cached by immutable identity rather
than fetched on every build. The [dependency upgrade checks](../src/prover/docs/proving.md#dependency-asset-resolution)
detect changed upstream loader requests; live CDN qualification runs before
release, not on every local build.

## Portable distribution

[Static Web Server v2](https://static-web-server.net/v2/) (SWS) is the sole
serving dependency. It is an open-source static file server with a
[TOML configuration](https://static-web-server.net/v2/configuration/config-file),
[path-matched response
headers](https://static-web-server.net/v2/features/custom-http-headers), ETags,
range requests, and [rootless multi-architecture container
images](https://static-web-server.net/v2/features/docker). No CCDP-specific
server or SWS plugin exists.

Build the portable distribution with:

```sh
pnpm --filter @libid/ceremony build:ccdp-artifacts -- --out-dir <directory>
```

It replaces the output directory only after validating the complete graph and
emits:

```text
<directory>/
├── public/
│   ├── ccdp/v{CCDPVersion}/callback.js
│   ├── ccdp/v{CCDPVersion}/prefetch
│   ├── ccdp/v{CCDPVersion}/prover/index.html
│   ├── ccdp/v{CCDPVersion}/prover/fallback
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
port = 80
root = "/home/sws/public"
page404 = "/home/sws/public/404.html"
cache-control-headers = false
compression = false
compression-static = true
security-headers = false
directory-listing = false
redirect-trailing-slash = false
health = false
text-charset = ""
```

No SPA fallback is configured. The `/prover` route resolves its generated
directory-index body without a trailing-slash redirect, allowing
`/prover/fallback` to coexist as a separate file. Headers match the public
request paths, not the physical index filename; the Prover bootstrap rejects
undeclared entry paths such as `/prover/index.html`. Other protocol routes map
directly to exact files. SWS uses generated Brotli sidecars for
`Accept-Encoding` negotiation and never compresses a response at request time.

The generator emits non-overlapping `advanced.headers` rules covering every
public resource. Assets with execution-worker CSP use their own exact path
rules, not a generic asset policy; identical profiles may be grouped only
without overlap. Those rules are compiled from the response-profile table; SWS does
not reconstruct policy. They set exact media, cache, isolation, framing, CORS,
CSP, and `Service-Worker-Allowed` headers. The generator rejects overlapping
patterns, an omitted profile, an unrepresented file, or any SWS option that
could weaken the [HTTP contract](#http-contract).

The checked-in container recipe is fixed apart from the SWS image digest:

```dockerfile
FROM ghcr.io/static-web-server/static-web-server:2-alpine@sha256:<pinned-digest>
COPY --chown=sws:sws public/ /home/sws/public/
COPY --chown=sws:sws sws.toml /etc/sws.toml
ENV SERVER_CONFIG_FILE=/etc/sws.toml
```

Release automation pins the SWS v2 image by digest, builds this image from the
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

The same image runs locally:

```sh
docker build --file <ccdp.Dockerfile> --tag libid-ccdp <directory>
docker run --rm --publish 8787:80 libid-ccdp
```

Rebuilding it for development changes no browser protocol or response policy.
