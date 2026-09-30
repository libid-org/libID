# Build and deployment

The build emits a static CCDP artifact; Static Web Server (SWS) serves it.
Resource and response requirements belong to the
[Distribution specification](https://github.com/libid-org/libid/blob/2b9afbf0afe45c398b16506a7db46dd3a4e38693/specs/ccdp-distribution.md).
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

`distribution-graph.json` is private build/test metadata and an input for retaining
previous immutable resources. It is not a runtime manifest or public resource.
The [container recipe](../ccdp.Dockerfile) replaces the base image's served
tree (it ships a placeholder `index.html`) with `public/`, copies `sws.toml`,
and places `distribution-graph.json` at `/home/sws/` outside the served root so
the next build can read retention state back out of a published image (see
[Publication and upgrades](#publication-and-upgrades)).
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
  'noir/1.0.0-beta.25/acvm_js_bg.wasm',
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
installed package integrity comes from the workspace lockfile. Developers own
release URLs and immutable mounts. There is no handwritten asset checksum list
or browser hashing step.

External declarations retain their URL, range, optional exact byte count and
fallback URLs. They emit no local body or response headers. They contribute to
prefetch metadata, the fetch allowlist and generated CSP. Native bb.js chooses
its fallback on failure; Prefetch does not speculatively download both mirrors.
The [pinned browser loader limitation](proving.md#dependency-asset-resolution)
means current CRS resources must remain external.

Each platform/version composes shared handles and its circuit/key in an asset
leaf; X and GitHub share the bearer-link leaf.
[platforms.assets.ts](../src/platforms/platforms.assets.ts) collects those sets and
derives the circuit list whose capacity the build checks. The compiler adds the selected execution chunks and nested-worker
edges, so their filenames are not declared again. A profile's chunks stop at other
platforms' provers, which the prover table reaches only lazily, and the notary runtime
has its own chunk, so Google fetches no notary code. Prefetch consumes metadata;
it never imports execution to discover dependencies.

## Headers and compression

[headers.ts](../src/assets/headers.ts) holds plain reusable policy records:
`immutable`, `javascript`, `wasm`, `json`, `document`, `executionWorker`, `dip`
and `isolated`. Resource declarations compose them with object spread and may
add explicit headers. [profiles.ts](../build/profiles.ts) applies document,
worker and `versions.json` policies using compiler-produced script hashes and
external origins.
No Markdown table or deployment template is another header source.

Declarations own MIME, caching, CSP and isolation policy. SWS owns ETags,
Last-Modified, lengths, encoding negotiation and range metadata. Handwritten
representation metadata and policies weakening required resource headers are
rejected. A whole CSP value is replaced, not implicitly concatenated.

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

- **Header rule matching.** Keep `redirect-trailing-slash = true`. The generated
  catch-all makes unresolved paths uncacheable; exact rules for physical files
  then apply after route rewriting. Matching details belong to [sws.ts](../build/sws.ts)
  and its [native canary](../build/sws.test.ts). Run that check when upgrading SWS;
  changing these rules can accidentally give 404s immutable cache headers.
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
the server emits none. The container writes nothing, so run it read-only with
all capabilities dropped, as CI does.

Configure the independently deployed Bridge with the CCDP origin, admitted
application origins and one OAuth client per platform. It fetches
`/ccdp/callback.html`, inserts deployment JSON into its non-executable slot, and
serves the complete configured document with matching executable hashes. It
retrieves nothing else: the client reads `/ccdp/versions.json` itself and runs
every version of a platform with that platform's client. Callback owns clearing
and bundled CCDP selection; the Bridge injects no code, enumerates no versions
and needs no per-version entry-script table.
The runnable reference configuration is in
[the dev app](../../../apps/dev/README.md), not this package.

Client derives fixed `/auth/callback` from the supplied Bridge origin and
freezes the redirect URI once; public configuration carries no callback path. X and GitHub use the supplied notary
origin's Proxy WebSocket for both token and identity sessions. Prover performs no
Bridge fetch; its HTTPS fetch sources serve proving assets, while WSS (or the
exact loopback WS exception) serves notarization. Bridge owns Callback refresh.

Optional opener-independent fallback is supplied through
[build/popup.ts](../build/popup.ts): a module exporting `fallback` and its required
connect sources. Supply the matching adapter to the application's popup
connection. Ceremony includes no WebRTC implementation or signaling service.

## Publication and upgrades

[ccdp-image.yml](../../../../.github/workflows/ccdp-image.yml) builds the artifact
and `linux/amd64` image, then runs checks against the container and pinned native
binary. [CI](../../../../.github/workflows/ci.yml) uses it as follows:

| Trigger | Publication |
|---|---|
| Pull request or manual dry run | Build and test only; no image push. |
| Push to `main` | Publish `ghcr.io/libid-org/ccdp:sha-<full commit sha>` and `:main`. |
| [Custom workflow](../../../../.github/workflows/ccdp-custom.yml), or `ccdp-custom/<tag>` branch | Publish the sha tag and `:custom-<tag>`. |
| GitHub Release `v<version>` | [Promote](../../../../.github/workflows/release.yml) the existing sha image to `:<version>` and, for a stable version, `:latest`. |

Release promotion verifies the source image's revision label and preserves its
digest; it never rebuilds. If the sha image is missing, first publish that commit
through a successful `main` run, then re-publish the release. Image digests appear
in the workflow summary. Custom images are outside the `:main` retention history;
deploy them by digest and replace them whole.

Before building, the workflow pulls the previously published `:main` image and
copies `/home/sws/public` and `/home/sws/distribution-graph.json` out of it into
the build output. The build then checks reused immutable URLs for identical
bytes and policies, retains the previous immutable assets, and replaces the
output only after success, so the compatibility window holds without a
persistent build directory. Only the registry's answer that the image does not
exist (a first publication) skips the seed, with a warning when publishing; any
other pull failure fails the run, so a publication never drops retained assets
silently and is re-run instead. Changing the bytes or policy of an already
published immutable URL fails the build by design; publish changed content
under a new mount.

Local release builds follow the same rule: build into the existing accumulated
output and preserve the whole of it, including `distribution-graph.json`,
between builds. A fresh empty output cannot retain resources from a previous
deployment.

Deploy the complete image pinned by digest (the one in the run summary), not by
a tag, which can move. Retention currently covers immutable assets, not an
automatic archive of every protocol version: only v1 is emitted. Adding or
retiring protocol versions needs explicit build support and a
compatibility-window plan. Application, Callback, Prover and root Worker must
remain compatible.

Before an image goes to a deployment, run
[distribution and browser checks](testing.md), including the actual dependency
loaders and served headers. A compiler-only build does not qualify live CRS,
consent, production Bridge behavior or physical devices.
The current [qualification gaps](qualification.md) remain release gates; the
published image is continuous-integration output, and promoting it to a
deployment is a separate, deliberate step.

## Build owners

[distribution.ts](../build/distribution.ts) assembles and promotes the artifact
and derives the prefetch manifest from the emitted Prover graph;
[bundle.ts](../build/bundle.ts) records emitted dependencies and loads a source module into a build script;
[fragment.ts](../build/fragment.ts) hands a document's launch fragment to its entry;
[assets.ts](../build/assets.ts) resolves declarations;
[assetPlugin.ts](../build/assetPlugin.ts) lowers them to built URLs and serves the request lists;
[profiles.ts](../build/profiles.ts) derives each response profile's headers and CSP;
[popup.ts](../build/popup.ts) is the optional popup-carrier integration point;
[ast.ts](../build/ast.ts) holds the AST helpers both plugins share;
[archive.ts](../build/archive.ts) parses archives without extracting to their paths;
[sources.ts](../build/sources.ts) reads declared sources and caches downloads;
[versions.ts](../build/versions.ts) reads the platform catalog's version set and
reconciles it with the emitted platform provers and the asset profiles;
[circuits.ts](../build/circuits.ts) checks capacity;
[sws.ts](../build/sws.ts) writes files, sidecars and native server configuration.
