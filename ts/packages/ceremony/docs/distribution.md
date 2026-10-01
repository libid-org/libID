# Build and deployment

The build emits a static CCDP artifact; Static Web Server (SWS) serves it.
Resource and response requirements belong to the
[Distribution specification](https://github.com/libid-org/libid/blob/aaed5c1e70aa8e66954ffdb0992c4b74720d8407/specs/ccdp-distribution.md).
The host needs no ceremony server, request-time compilation or asset downloads.

## Build and serve

From the repository root, with Node 24+, pnpm and Docker:

```sh
pnpm -C ts install --frozen-lockfile
pnpm -C ts --filter '@libid/ceremony...' build
pnpm -C ts --filter @libid/ceremony build:ccdp-artifacts

docker build -f ts/packages/ceremony/ccdp.Dockerfile \
  -t libid-ccdp ts/packages/ceremony/dist-artifacts
docker run --rm -p 127.0.0.1:8080:8787 libid-ccdp
```

The build scripts run directly with Node's TypeScript stripping;
`typecheck:build` checks them separately. The default output is
`packages/ceremony/dist-artifacts` within `ts`. An optional `--out-dir` selects
another dedicated directory inside the checkout. Release downloads are cached
under the ceremony package's `.cache/downloads/`.

```text
dist-artifacts/
├── public/
│   ├── ccdp/callback.html
│   ├── ccdp/versions.json
│   ├── ccdp/v1/prefetch.html
│   ├── ccdp/v1/prover.html
│   ├── ccdp/v1/prover-fallback.html
│   ├── ccdp/v1/worker.js
│   ├── ccdp/assets/...
│   └── 404.html
├── sws.toml
└── distribution-graph.json
```

`distribution-graph.json` is private build and test metadata: not a runtime
manifest, a public resource or part of the image. The
[container recipe](../ccdp.Dockerfile) replaces the base image's served tree (it
ships a placeholder `index.html`) with `public/` and copies `sws.toml`.
Exact internal rewrites serve the document routes without `.html`; direct
navigation to their physical `.html` files does not execute a ceremony.
Unknown routes return 404 with no SPA fallback and an explicit error policy
(`Cache-Control: no-store` and the inert `404.html` headers, see
[Native server behavior](#native-server-behavior)): absent cache headers would
leave a 404 heuristically cacheable.

## Version catalog

`/ccdp/versions.json` publishes the bundled platform ceremony versions, for example
`{"google":[1],"x":[1],"github":[1]}`. Each list is nonempty, duplicate-free,
ascending and limited to unsigned 16-bit versions. The build derives the record
in [catalog](../src/platforms/index.ts) order and fails by pair name unless the
emitted [platform provers](../src/platforms/provers.ts) and asset profiles name
exactly the same pairs. It describes the Distribution, so its path is unversioned.

The response is JSON with `nosniff`, `Cache-Control: no-cache` and a native ETag.
It supports `GET` and `HEAD` without redirect. It alone carries
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`.
It needs no origin-dependent `Vary`; SWS may add `Vary: accept-encoding`.
Only the Application's [client](client.md#platform-and-version-discovery) fetches
it. Bridge and CCDP documents do not. Asset discovery remains build-owned.

## Source declarations

Declare a dependency once in its owner's `*.assets.ts`. The internal
[assets API](../src/assets/index.ts) supplies three declaration forms:

```ts
import * as assets from '../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.4.0/tlsn-wasm-0.4.0.tar.gz',
  'tlsn/v0.4.0',
  'sha256:3e1ee9cc85f7f2bfc65946d3b69a5a4064fa688cc804f181c971febaaa53a0b1',
)
const module = release.member('tlsn_wasm.js', {
  ...assets.headers.immutable,
  ...assets.headers.javascript,
})
const spawn = release.member('snippets/web-spawn-*/js/spawn.js', {
  ...assets.headers.immutable,
  ...assets.headers.executionWorker,
})
const acvm = assets.file(
  'npm:@noir-lang/acvm_js/web/acvm_js_bg.wasm',
  'noir/{version}/acvm_js_bg.wasm',
  { ...assets.headers.immutable, ...assets.headers.wasm },
)
const crs = assets.external('https://crs.aztec-cdn.foundation/g1_compressed.dat', {
  range: 'bytes=0-8388607',
  fallback: ['https://crs.aztec-labs.com/g1_compressed.dat'],
})

// Execution resolves the same handle synchronously; this does not fetch.
const moduleUrl = assets.assetUrl(module)
const crsUrl = assets.assetUrl(crs) // The original external URL.
```

The real declarations live in [notary.assets.ts](../src/notary/notary.assets.ts)
and [barretenberg.assets.ts](../src/barretenberg/barretenberg.assets.ts).

An archive source is an HTTPS URL or local path; relative paths resolve from the
ceremony package. The build reads it once and publishes only declared members beneath
`/ccdp/assets/<mount>/`, retaining their relative directories. Declare any companion
files needed by archive-relative imports as members too. A member selector
must match exactly one file; `*` matches within a directory component, never
across `/`, and the final filename is exact. Traversal, links, duplicates,
conflicting bodies/policies and sidecar collisions fail the build.

Mounted files become servable, but only selected profile dependencies are
prefetched. Standalone files accept installed `npm:` paths or declared sources;
installed package integrity comes from the workspace lockfile. An installed file's
mount spells `{version}`, which the build replaces with the installed package's
version, so upgrading the package moves the file to a new immutable path. Every HTTPS source
declares its `sha256:` digest, and the build refuses bytes that do not match, from
a fresh download or the cache. To upgrade a release, change its URL, mount and
digest together; `gh release view <tag> -R <repo> --json assets` and the release
page show each asset's digest. Developers own release URLs and immutable mounts.
Browsers do no asset hashing.

External declarations retain their URL, range, optional exact byte count and
fallback URLs. They emit no local body or response headers. They contribute to
the request lists, the fetch allowlist and generated CSP. Native bb.js chooses
its fallback on failure; Prefetch does not speculatively download both mirrors.
The [pinned browser loader limitation](proving.md#dependency-asset-resolution)
means current CRS resources must remain external.

Each platform/version composes shared handles and its circuit/key in an asset
leaf; X and GitHub share the bearer-link leaf.
[platforms.assets.ts](../src/platforms/platforms.assets.ts) collects those sets and
derives the circuit list whose capacity the build checks. The compiler adds the selected execution chunks and nested-worker
edges, so their filenames are not declared again. A profile's chunks stop at other
platforms' provers, which the prover table reaches only lazily, and the notary runtime
has its own chunk, so Google fetches no notary runtime. Prefetch consumes the request
lists; it never imports execution to discover dependencies.

## Headers and compression

[headers.ts](../src/assets/headers.ts) holds plain reusable policy records:
`immutable`, `javascript`, `wasm`, `json`, `documentHeaders`, `executionWorker`, `dip`
and `isolated`. Resource declarations compose them with object spread and may
add explicit headers. [profiles.ts](../build/profiles.ts) applies document,
worker and `versions.json` policies using compiler-produced script hashes and
external origins; these declarations are the only header source.

Declarations own MIME, caching, CSP and isolation policy. SWS owns ETags,
Last-Modified, lengths, encoding negotiation and range metadata. Handwritten
representation metadata and policies weakening required resource headers are
rejected. A declared CSP value replaces the whole default one.

The build normalizes gzip-packed WASM to decoded `.wasm` bodies. It emits Brotli
and gzip sidecars only when smaller. SWS uses native precompressed serving;
request-time compression is disabled. Browsers fetch the unencoded resource URL,
and Cache Storage retains decoded bodies. Gzip also serves browsers that do not
advertise Brotli, including WebKit on local HTTP.

SWS's ETags depend on file metadata. Changed bytes at stable protocol URLs must
also change file metadata, even when their length is unchanged. Do not normalize
all releases to one fixed timestamp. The native-server regression in
[testing](testing.md#distribution-checks) checks this behavior.

### Native server behavior

The pinned SWS 3.0.0-beta.1 has behavior that the generated configuration and
the tests account for:

- **Header rule matching.** SWS matches `[[advanced.headers]]` sources against
  the request path after rewrites and applies every matching rule in config order,
  later rules overwriting. The generated catch-all `/**` comes first with the
  uncacheable error policy, and one exact rule per physical file overwrites the
  names it declares. A route and its direct `.html` request therefore share one
  rule, a 404 carries only the error policy, and a 200 keeps the catch-all's value
  for a name its declaration omits, such as the CSP on a plain asset. Keep
  `redirect-trailing-slash = true`: without it, and for directory-index requests,
  SWS appends the resolved file name before matching. The
  [native canary](../build/sws.test.ts) pins this model; run it when upgrading SWS,
  since changed matching can give 404s immutable cache headers.
- **`./config.toml` precedence.** A `config.toml` in the working directory is read
  instead of the `--config-file`/`SERVER_CONFIG_FILE` path. Run local binaries from
  a directory without one; the image's working directory, `/home/sws`, has none.
- **Unknown keys.** Unrecognized TOML options are ignored, not rejected, so a
  misspelled option does not fail startup. The tests check the emitted values.
- **`security-headers` stays off.** It would add HSTS
  (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options` and a
  `frame-ancestors 'self'` CSP to every response, overriding declared policy.
  HSTS belongs to the ingress on the CCDP origin.

## Bridge and popup integration

Run the image behind transparent HTTPS ingress on a dedicated cookie-free CCDP
origin. Preserve paths, response headers, validators and compression negotiation.
The server may use plain HTTP internally. Browser HTTP is allowed only for the
supported loopback origins; production platform requests still use HTTPS.

The container listens on 8787 and answers `GET /health` with 200; use that path
for readiness and liveness probes. Terminate TLS and set HSTS at the ingress;
the server emits neither. The container only reads, so run it read-only with
all capabilities dropped, as CI does.

Configure the independently deployed Bridge with the CCDP origin, admitted
application origins and one OAuth client per platform. It fetches
`/ccdp/callback.html`, inserts deployment JSON into its non-executable slot, and
serves the complete configured document with matching executable hashes. That
is its only fetch: the client reads `/ccdp/versions.json` itself and runs
every version of a platform with that platform's client. Callback owns clearing
and bundled CCDP selection; the Bridge injects no code, enumerates no versions
and needs no per-version entry-script table.
The runnable reference configuration is in
[the dev app](../../../apps/dev/README.md), not this package.

Client derives fixed `/auth/callback` from the supplied Bridge origin and
freezes the redirect URI once; public configuration carries no callback path. X and GitHub use the supplied notary
origin's Proxy WebSocket for both token and identity sessions. Prover performs no
Bridge fetch; its HTTPS fetch sources serve proving assets and Google's JWKS, while WSS (or the
exact loopback WS exception) serves notarization. Bridge owns Callback refresh.

The documents accept the popup connection without a fallback carrier; ceremony
includes no WebRTC implementation or signaling service.

## Publication and upgrades

[ccdp-image.yml](../../../../.github/workflows/ccdp-image.yml) builds the artifact
and `linux/amd64` image, then runs checks against the container and pinned native
binary. [CI](../../../../.github/workflows/ci.yml) uses it as follows:

| Trigger | Publication |
|---|---|
| Pull request or manual dry run | Build and test only; no image push. |
| Push to `main` | Publish `ghcr.io/libid-org/ccdp:sha-<full commit sha>` and `:main`, one publication at a time. |
| [Custom workflow](../../../../.github/workflows/ccdp-custom.yml), or `ccdp-custom/<tag>` branch | Publish `:custom-<tag>` only. |
| GitHub Release `ccdp-v<version>`, such as `ccdp-v1` or `ccdp-v1.2.0` | [Promote](../../../../.github/workflows/release.yml) the commit's sha image to `:<version>` and, for a version without `-`, `:latest`. |

CCDP versions are their own; a `v<version>` release publishes only the npm
packages. Release promotion requires the tagged commit to be on `main` and the
source image's revision and version labels to name it as a `main` publication,
and it preserves the digest; it never rebuilds. If the sha image is missing, re-run
that commit's `ccdp-publish` job, then re-publish the release. Image digests appear
in the workflow summary. Deploy custom images by digest and replace them whole.

An image serves the latest minor release of each CCDP major it includes, and
nothing from earlier minors: a minor update replaces the previous minor's files
whole. Which majors an image includes is an explicit choice; today only v1
exists, so an image serves exactly the build it was made from. Publish changed
content under a new mount so that a URL never changes its bytes; the sha256
pins stop a release archive from changing under its mount. As REQ-DIST-05
allows, a ceremony running during a minor update can fail on a file the new
build changed, and the user starts it again.

Deploy the complete image pinned by digest (the one in the run summary), not by
a tag, which can move. Cut over atomically per origin: serve one revision at a
time, never a mix of revisions behind one ingress. Blue/green or drain then
switch does it without downtime; stopping the old instance before starting the
new one (Kubernetes `Recreate`) does it with a brief outage. Each build answers
the other's changed chunks with 404, so a mix of revisions breaks ceremonies.

Roll back forward: revert on `main` and publish a new build, or redeploy an
older image; either way a ceremony already running the rolled-back build may
fail once and restart. A browser that already holds the newer
document revalidates correctly against the older one, because its changed ETag
wins over the older `Last-Modified`
([native SWS test](../build/sws.test.ts)).

A CDN in front of SWS works with the responses as they are; configure it to:

- honor origin `Cache-Control`: cache the `immutable` assets as long as it likes,
  and revalidate the `no-cache` documents, `worker.js` and `versions.json` on every
  use;
- forward every response header unchanged, in particular
  `Document-Isolation-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`,
  `Content-Security-Policy` and `Service-Worker-Allowed`;
- never transform bodies: HTML or script rewriting (minification, injected or
  deferred scripts, email obfuscation) breaks the documents' inline-script
  hashes, and they stop running;
- forward `Range` requests and key compressed variants by `Accept-Encoding`
  (SWS sends `Vary: Accept-Encoding`).

A CDN does not replace the atomic switch: a request for a file it has not cached
yet still reaches the origin. 404s are `no-store`, so it never caches a missing
file. Only v1 is emitted. Including an older major beside a new one needs build
support: the older major's latest release pinned explicitly, its documents and
assets served beside the new ones, and a root Worker that serves both. The
Application, Callback, Prover and root Worker must remain compatible.

Before an image goes to a deployment, run
[distribution and browser checks](testing.md), including the actual dependency
loaders and served headers. A compiler-only build does not qualify live CRS,
consent, production Bridge behavior or physical devices.
The current [qualification gaps](qualification.md) remain release gates; the
published image is continuous-integration output, and promoting it to a
deployment is a separate, deliberate step.

## Build owners

[distribution.ts](../build/distribution.ts) assembles the artifact
and derives the request lists from the emitted Prover graph;
[output.ts](../build/output.ts) replaces the output whole;
[bundle.ts](../build/bundle.ts) records emitted dependencies and loads a source module into a build script;
[fragment.ts](../build/fragment.ts) hands a document's launch fragment to its entry;
[assets.ts](../build/assets.ts) resolves declarations;
[assetPlugin.ts](../build/assetPlugin.ts) lowers them to built URLs and serves the request lists;
[profiles.ts](../build/profiles.ts) derives each response profile's headers and CSP;
[ast.ts](../build/ast.ts) holds the AST helpers both plugins share;
[archive.ts](../build/archive.ts) parses archives without extracting to their paths;
[sources.ts](../build/sources.ts) reads declared sources, caches downloads and guards the output directory;
[versions.ts](../build/versions.ts) reads the platform catalog's version set and
reconciles it with the emitted platform provers and the asset profiles;
[circuits.ts](../build/circuits.ts) checks capacity;
[sws.ts](../build/sws.ts) writes files, sidecars and native server configuration.
