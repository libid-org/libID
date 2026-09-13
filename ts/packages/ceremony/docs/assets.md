# Asset prefetch and caching

[Resource declarations](distribution.md#source-declarations) and compiler output
select each platform/version's exact request set. Prefetch warms those bytes
while the user authorizes. It does not initialize WASM, proof backends or TLSN
sessions, and no initialized runtime survives OAuth navigation.

## Worker ownership

[registration.ts](../src/assets/registration.ts) resolves the canonical root
registration, including when a stale nested registration uses the same script.
It retires that known nested registration only when its workers use the canonical
script URL; unrelated registrations remain untouched. It waits for the selected
worker to activate and never dispatches to an older active worker while an update
is installing or waiting.

[prefetch.ts](../src/ccdp/documents/prefetch.ts) is a dual document/Worker entry.
The [Worker](../src/assets/worker.ts) combines popup's port keeper with asset
fetching. Install uses `skipWaiting`, activation uses `clients.claim`, and Prover
explicitly joins root-worker control before readiness. Failure to establish the
required registration/control is terminal.

The private Worker message accepts a catalog profile, never caller-supplied URLs.
The dispatch acknowledgement means every selected request has a cache hit or a
fetch invocation. It does not wait for response bodies or persistence. Only after
that acknowledgement and popup authentication may Prefetch emit
`prefetch-dispatch.finished` and Client navigate to Authorization.

## Delivery and lifetime

[AssetCache.load](../src/assets/cache.ts) keeps one pending fetch per exact URL
and Range. Each caller gets an independently readable response. Its three promises
separate dispatch, validated response delivery and best-effort persistence;
Worker `waitUntil` and the pending entry remain alive through persistence.
A failed Cache Storage write cannot delay or invalidate a valid response.

Ordinary cache hits validate headers and return the cached Response without
rereading or copying the body. Bodies were checked before insertion. Ranged CRS
hits reconstruct a 206 from stored prefix bytes because Cache Storage cannot
store 206 responses directly. Range and byte-count checks prevent a full-file
response or another prefix from masquerading as the requested resource.

Fetches use `force-cache`, so Cache Storage misses or denial can still reuse the
browser HTTP cache. The Worker fetches without credentials and only intercepts
GETs in the build's exact URL/range allowlist. It does not cache OAuth, Bridge
configuration/token exchange, platform HTTP requests or ceremony HTML. Native
requests outside that allowlist remain untouched.

Completed bodies use one shared immutable-asset cache namespace; there is no
per-release cache deletion. Repeated URLs remain reusable across platforms and
rebuilds. bb.js independently owns its processed-CRS IndexedDB cache; ceremony
caches the raw declared CRS responses and does not duplicate that processing.

Navigation destroys the Prefetch document, not the Worker's pending requests.
If the Worker terminates, later requests reuse completed entries and fetch
missing ones normally. There is no durable completion marker or ceremony resume
state. Fetch, quota and eviction failures change latency, not the selected assets,
isolation or proof requirements. See [testing](testing.md) and the remaining
[cache fault matrix](qualification.md#remaining-qualification).
