# Build and deployment

The build emits a static CCDP artifact; Static Web Server (SWS) serves it.
Resource and response requirements belong to the
[Distribution specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md).
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

## Source declarations

Declare a dependency once in its owner's `*.assets.ts`. The internal
[assets API](../src/assets/index.ts) supplies three declaration forms:

```ts
import * as assets from '../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.3.0-rc.3/tlsn-wasm-0.3.0-rc.3.tar.gz',
  'tlsn/v0.3.0-rc.3-csp1',
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
const moduleUrl = assets.resolve(module)
const crsUrl = assets.resolve(crs) // The original external URL.
```

The real declarations live in [notary.assets.ts](../src/notary/notary.assets.ts)
and [barretenberg.assets.ts](../src/barretenberg/barretenberg.assets.ts).

An archive source is an HTTPS URL or local path; relative paths resolve from the
ceremony package. The build reads it once and mounts all regular files beneath
`/ccdp/assets/<mount>/`, retaining their relative directories. A member selector
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

Each platform/version composes shared handles and its circuit/key in its own
asset leaf. [platforms.assets.ts](../src/platforms/platforms.assets.ts) collects
those sets. The compiler adds the selected execution chunks and nested-worker
edges, so their filenames are not declared again. Prefetch consumes metadata;
it never imports execution to discover dependencies.

## Headers and compression

[headers.ts](../src/ccdp/headers.ts) holds plain reusable policy records:
`immutable`, `javascript`, `wasm`, `json`, `document`, `executionWorker`, `dip`
and `isolated`. Resource declarations compose them with object spread and may
add explicit headers. [profiles.ts](../build/profiles.ts) applies document and
worker policies using compiler-produced script hashes and external origins.
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

- **Header rule matching.** `[[advanced.headers]]` sources are globs matched
  against the request path after internal rewrites, so one exact rule per
  physical file (`/ccdp/v1/prefetch.html`) covers its route and its direct
  `.html` request. SWS appends `/<resolved file name>` before matching only for
  a directory-index request (`/dir/`, or any resolved file when
  `redirect-trailing-slash = false`). The distribution serves no directory index
  and keeps the redirect on, so [sws.ts](../build/sws.ts) never emits that form:
  keyed on `<file>/<name>`, it equals the raw path of the 404 beneath the file
  and made that 404 immutable. A response that resolved no file (every 404, and
  the `308` a directory path such as `/ccdp/assets` gets to `/ccdp/assets/`,
  which returns 404) is matched on the raw request path, and every matching rule
  applies in config order, later rules overwriting. The first emitted rule is therefore the
  catch-all `/**` carrying the error policy, `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`
  and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  which `/404.html` itself declares. Each exact rule after it overwrites the
  names it declares on its own file; a 200 keeps the catch-all's value for a
  name its declaration omits (the CSP on a plain asset, inert outside documents
  and workers, which all declare their own). The
  [canary test](testing.md#distribution-checks) pins this matching against the
  real binary; when it fails on a newer SWS, revisit `sws.ts` and this section.
- **`./config.toml` precedence.** A `config.toml` in the working directory is read
  instead of the `--config-file`/`SERVER_CONFIG_FILE` path. Run local binaries from
  a directory without one; the image's working directory, `/home/sws`, has none.
- **Unknown keys.** Unrecognized TOML options are ignored, not rejected, so a
  misspelled option does not fail startup. The tests check the emitted values.
- **`security-headers` stays off.** It would add HSTS
  (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options` and a
  `frame-ancestors 'self'` CSP to every response, overriding declared policy.
  HSTS belongs to the ingress on the CCDP origin.
- **HEAD responses carry no `Content-Length`.** GET responses do; harmless.
- **Health and port.** `health = true` answers `GET /health` with 200 and no custom
  headers, and the image inherits `EXPOSE 8787`.

## Bridge and popup integration

Run the image behind transparent HTTPS ingress on a dedicated cookie-free CCDP
origin. Preserve paths, response headers, validators and compression negotiation.
The server may use plain HTTP internally. Browser HTTP is allowed only for the
supported loopback origins; production platform requests still use HTTPS.

The container listens on 8787 and answers `GET /health` with 200; use that path
for readiness and liveness probes. Terminate TLS and set HSTS at the ingress;
the server emits none. The container writes nothing, so run it read-only with
all capabilities dropped, as CI does.

Configure the independently deployed Bridge with the CCDP origin and admitted
application origins. It fetches `/ccdp/callback.html`, inserts deployment JSON
into its non-executable slot, and serves the complete configured document with
matching executable hashes. Callback owns clearing and bundled CCDP selection;
the Bridge injects no code and needs no per-version entry-script table.
The runnable reference configuration is in
[the dev app](../../../apps/dev/README.md), not this package.

The current integration still uses config `callbackPath` and GitHub request
`redirectUri`; both require the [coordinated fixed-path migration](qualification.md#pending-contract-updates).
Client freezes the redirect URI once and the GitHub adapter checks its binding.
GitHub's requested notary host selects the Bridge's native MPC-TLS destination
with its configured TCP port. Browser sessions use that origin's HTTP/WebSocket
port. Bridge egress/DNS controls and artifact refresh are server responsibilities.

Optional opener-independent fallback is supplied through
[build/popup.ts](../build/popup.ts): a module exporting `fallback` and its required
connect sources. Supply the matching adapter to the application's popup
connection. Ceremony includes no WebRTC implementation or signaling service.

## Publication and upgrades

The reusable [ccdp-image.yml](../../../../.github/workflows/ccdp-image.yml)
workflow builds the artifact and the `linux/amd64` image, runs the distribution
checks against the running container and the pinned native binary, and pushes
the image only when asked to. Two jobs in
[ci.yml](../../../../.github/workflows/ci.yml) call it. `ccdp-image` runs on
every pull request with a read-only token and builds and tests without
pushing. `ccdp-publish` runs on every push to `main`, is the only CI job that
holds the package write permission, and pushes
`ghcr.io/libid-org/ccdp:sha-<commit sha>` (the full 40-hex sha, never a
prefix) and `ghcr.io/libid-org/ccdp:main`, printing the pushed digest in the
run summary. Every image carries the built commit in its
`org.opencontainers.image.revision` label, with the source repository and the
version (`main` when published, else the sha tag) in the matching OCI labels.
The workflow can also be dispatched by hand for a dry run, which never pushes.

Publishing a GitHub Release `v<version>` runs
[release.yml](../../../../.github/workflows/release.yml), which publishes
`ghcr.io/libid-org/ccdp:<version>` and, for a stable version (no `-` prerelease
suffix, the npm dist-tag rule), `ghcr.io/libid-org/ccdp:latest`. The release
promotes rather than rebuilds: it retags the `sha-<commit sha>` image of the
released commit registry-side, so the release image is byte-identical to the
image built and tested when that commit landed on `main` — the same digest,
which the job verifies for every new tag and prints next to the source digest
in the run summary. Before retagging, the job reads the image's revision label
and refuses to promote unless it names the released commit. Promotion needs no
retention seed because it publishes that exact image. A release never builds.
Without a `sha-` image (the commit never landed on `main`, or its `main` run
failed) the job fails and names the fix: merge to `main`, let `ccdp-publish`
run, then re-publish the release. Only images published from `main` enter the
`:main` retention history described next; an image built anywhere else would
be missing from it, and its assets could vanish from the next deployment.

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

[distribution.ts](../build/distribution.ts) assembles and promotes the artifact;
[bundle.ts](../build/bundle.ts) records emitted dependencies;
[assets.ts](../build/assets.ts) resolves declarations;
[archive.ts](../build/archive.ts) parses archives without extracting to their paths;
[release.ts](../build/release.ts) caches downloads;
[circuits.ts](../build/circuits.ts) checks capacity;
[sws.ts](../build/sws.ts) writes files, sidecars and native server configuration.
