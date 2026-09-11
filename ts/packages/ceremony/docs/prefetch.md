# Asset caching and prefetch and cache lifecycle

## Prefetch and cache lifecycle

Every ceremony attempts consent-overlapped prover prefetch. It is fixed
behavior, not configuration or action input. CCDP's Prefetch implementation
registers the shared module Service Worker and asks it to start only the
selected platform/version profile's artifact single flights. Prefetch, Prover,
and Worker implementations come from one compatible package release.

After registration, the Window branch selects the newest registration
candidate, waits through installation and waiting until it becomes active,
posts the exact selected profile to that Worker, and reports dispatch without
waiting for downloads. It never dispatches to a stale active Worker while a
newer candidate is installing or waiting. The Worker composes the popup
package's bounded MessagePort keeper with the selected immutable-asset and CRS
single flights in one canonical root registration, regardless of stale nested
registrations left by earlier deployments. A Worker which
receives the prefetch request exact-validates it and attaches the fetch work to
the message event with `event.waitUntil`.

The worker calls `skipWaiting()` during install and `clients.claim()` during
activation so later prover documents use the selected release rather than a
stale controller. Activation does not proactively delete reusable immutable
Cache Storage entries or bb.js CRS data. Immutable URLs keep already loaded
documents pinned; a live ceremony may still fail closed across deployment
rotation as defined by the [CCDP Distribution contract](distribution.md#protocol-resources).

The Prefetch bootstrap accepts only the closed, cleared profile selected by its
fragment and selects its resolved resource set from the lightweight catalog.
Having metadata for all supported profiles does not fetch unselected assets.
Neither fragment nor message can supply an asset path.

Prefetch and its Worker contain fetching/cache logic and resource metadata,
not platform execution or proving/notarization runtime code. They may fetch
the selected emitted JavaScript chunks and workers as inert bytes for later
execution; fetching those scripts does not import or execute them. The
`/prover` HTML response, including its embedded entrypoint, is fetched by
navigation and is not part of this asset prefetch. Its separately fetched
dependencies are. Bundle qualification checks the import boundary as well as
the emitted code, rather than relying on tree-shaking to remove unused runtimes.

The prefetch branch contains no OAuth or proof input. The separately imported
popup handler owns only its bounded temporary continuity entries. The branch
owns each selected asset fetch from the first byte and keys single flights by
canonical URL plus range where applicable. It fetches missing runtime assets, selected circuits,
WASM, and the pinned raw BN254/Grumpkin CRS bodies concurrently, sharing pending
asset and range-keyed CDN raw-CRS fetches between requests. It extends the
initiating worker event through completion. Prefetch warms bytes, not computation: it does not
initialize proof backends, preprocess CRS, or retain WASM instances or
TLSNotary sessions across OAuth. Merely importing bb.js is not CRS prefetch.

Ordinary local-asset prefetches use `credentials: 'same-origin'`, matching
native module and worker requests. Fetch-event handling preserves the admitted
request's URL and response semantics so Firefox can reuse a prefetched worker
response rather than refetching or synthesizing a different module. CDN CRS
requests follow the range-aware cache contract above; they are CORS fetches,
not cross-origin worker-script imports.

Its package-private prefetch call is an implementation detail, not a CCDP
message or exported ceremony API. The worker intercepts only exact local-asset
and external CRS requests in the selected platform/version leaf's pinned
prefetch set. It
leaves every other request to the browser unchanged: ceremony routes, the
GitHub token exchange, platform APIs, OAuth navigation, HTML, and configuration
are never cached, rewritten, or synthesized by this worker.

As soon as active-worker selection and the prefetch request settle, without
waiting for download completion, the Prefetch emits CCDP's `PrefetchStarted`.
Registration or activation failure is terminal under the package's fixed
prefetch/cache contract; artifact fetch failure records no weaker mode and
leaves proving on the identical cold path. The active prover resolves
the same profile using the exact `AppStartProver` platform/version. Ordinary asset
requests join an in-flight fetch or return the completed Cache Storage response
after validating its headers, without rereading or copying its body. Complete
bodies are validated before storage; CRS partial responses retain their range
reconstruction and byte-count checks. A Cache Storage miss or storage denial
uses `force-cache` for these immutable URLs, allowing browser HTTP-cache reuse. It
joins raw-CRS fetches in the same way. Backend initialization uses the explicit
options above and keeps bb.js's native processed-CRS IndexedDB cache enabled;
on a miss its normal CRS loading consumes the prefetched raw responses.
The worker does not reproduce that processing or maintain a
second processed-CRS cache.

A later ceremony reuses every repeated artifact URL and the same CRS entries;
only missing profile assets are fetched. OAuth navigation therefore neither
restarts shared work nor downloads unrelated profiles. The Prefetch and active
Prover share the CCDP origin and worker registration, so the final Prover
reuses the same fetches and caches.

A new document reconnects to the worker rather than awaiting a Promise owned
by a destroyed prefetch document. Completed asset and raw-CRS responses live in
Cache Storage; processed CRS from backend initialization lives in bb.js's
native IndexedDB cache. If the worker stops midway, completed responses remain
usable and missing resources follow the normal fetch path. No separate durable
completion marker exists.

Service-worker asset caches are separated by asset release, while unchanged
content-addressed URLs remain reusable across releases. A new release checks
retained caches for those identical URLs rather than forcing downloads merely
because the cache namespace changed. Stable protocol endpoints revalidate;
immutable asset paths do not change without changed content or response policy.

Registration and activation failure are terminal. A missing or malformed
selected profile also fails before OAuth. Fetch, eviction, or quota
failure follows the identical selected-profile cold fetch path and changes
latency only; it never weakens isolation, worker count, or verification. Warm
state is never a ceremony checkpoint.

### PoC measurements and rationale

The retained PoC optimizations above reportedly brought X proving to roughly
six seconds in the tested setup; this is not a cross-browser latency target or
an OAuth-inclusive timing guarantee. In a small Chromium A/B sample, custom
pre-OAuth CRS preprocessing reduced cold backend initialization by about 740 ms
but total post-OAuth proving by only about 200 ms. It was removed: warm runs
already benefited from the native processed-CRS cache. Preserve raw-byte
prefetch and native caching without introducing another preprocessing pipeline.

Concurrent span durations are not additive elapsed time. A displayed prefetch
benefit estimates work completed before proving, not a measured counterfactual
speedup. The active path skips local cryptographic proof verification; a PoC
UI label saying “verified proof” does not establish otherwise. Ledger Verifier
acceptance remains authoritative.

## Implementation guide

Owns root Service Worker registration, immutable cached response bodies and pending
fetch sharing. Pre-OAuth work warms bytes, not initialized proof or TLSNotary runtimes.

- [Dependency loaders](proving.md#dependency-asset-resolution): exact native URLs and ranges.
- [Distribution graph](distribution.md#source-declarations): one owner declaration per resource.

[registration.ts](../src/assets/registration.ts) resolves root ownership and dispatches selected
profiles. [worker.ts](../src/assets/worker.ts) composes popup continuity with [cache.ts](../src/assets/cache.ts).
The browser/worker entrypoint lives in [ccdp/documents/prefetch.ts](../src/ccdp/documents/prefetch.ts).
