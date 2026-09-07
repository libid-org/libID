# Ceremony metrics and diagnostics

This document defines the measurements needed to understand one
`@libid/ceremony` attempt in development, qualification, and production. It
does not define product progress, protocol authority, retry policy, or an
application analytics product.

The public [`CeremonyEvent`](../src/client/docs/client.md#progress-cancellation-and-recovery) stream remains the small,
stable product-progress surface. Diagnostics are a separate, opt-in stream
with finer spans, facts, counters, and terminal outcomes. A diagnostic record
is never evidence that a ceremony succeeded and never drives ceremony state.
Popup lifecycle, connection, carrier, continuity, control, and locally
undeliverable connection failures are defined by the
[popup metrics contract](../../popup/METRICS.md); ceremony may consume those
sanitized records but does not redefine them.

## Collection boundary

Each browser context measures its own work with the native Performance API:

- `performance.now()` measures local durations;
- `performance.timeOrigin + performance.now()` timestamps cross-context
  records on one comparable browser timeline;
- `PerformanceObserver` and Resource Timing may supply aggregate fetch facts;
- explicit marks surround application work which browser resource timing
  cannot describe.

Callback and Prover send only bounded, sanitized diagnostic records
over the ceremony's already-authenticated popup connection. The Ceremony Client
combines them with its own records and exposes one optional application
observer. No diagnostic record changes CCDP ordering or requires an
acknowledgement.

The observer is disabled by default. When absent, implementations should pay
only the cost of the marks already needed for product progress and internal
timeouts. Observer or exporter failure is inert and must not delay, fail, or
retry the ceremony.

### Undeliverable failures

Popup-connection failures follow the popup metrics contract. Every other caught
ceremony failure which cannot be delivered through CCDP emits one local
`console.error` containing only a ceremony-owned subsystem and stable error
code. When a local diagnostics or metrics sink is available in that browser
context, it also records the same sanitized failure best effort.

Package-side local reporting initiates no network request, durable record,
retry, recovery, or ceremony outcome. It never logs the raw exception object or
any value forbidden by the privacy rules below. Failure to report locally is
inert. An application observer may export the sanitized record under its normal
policy.

## Instrumentation choice

OpenTelemetry is an export adapter, not an internal ceremony dependency.

One ceremony attempt maps naturally to one trace, and the span catalogs below
map naturally to child spans. The application may translate the sanitized
diagnostic stream into its existing OpenTelemetry provider and exporter. The
package must not pass an OTLP endpoint into Callback or Prover and
must not run an exporter or automatic fetch/document instrumentation there.

This boundary is deliberate:

- the package is a library, so the application owns sampling, consent,
  resource attributes, batching, and export policy;
- Callback and Prover CSPs do not gain a telemetry `connect-src`;
- the prover exposes no telemetry destination;
- credentials, URLs, headers, bodies, witnesses, and proofs cannot be captured
  accidentally by automatic instrumentation;
- navigation or popup closure cannot strand multiple independent exporter
  queues; and
- applications without OpenTelemetry add no SDK or exporter weight.

The OpenTelemetry JavaScript trace API and SDK are stable, but its browser
client instrumentation remains
[experimental and mostly unspecified](https://github.com/open-telemetry/opentelemetry-js#browser-support).
Browser OTLP export also requires an HTTP exporter, compatible CSP, CORS, and a
[publicly reachable collector boundary](https://opentelemetry.io/docs/languages/js/exporters/#usage-in-the-browser).
Those constraints belong at the application integration boundary.

The first implementation therefore needs only a package-owned observer. A
separate optional OpenTelemetry adapter may be added when an integrating
application needs it; the core package does not need an OpenTelemetry
dependency. Aggregate latency and failure metrics can initially be derived
from exported traces, so a second browser Metrics SDK path is unnecessary.

The concrete observer API and CCDP representation are intentionally deferred
until the diagnostic message definitions settle. They must preserve the data
and privacy rules below rather than expose an OpenTelemetry object across
documents.

## Record model

The diagnostics stream needs four record kinds:

| Kind | Meaning |
|---|---|
| span | Bounded work with `started` and exactly one `completed` or `failed` lifecycle |
| fact | One bounded property of the runtime or selected path |
| counter | A nonnegative count or byte total |
| outcome | One terminal ceremony result and stable failure classification |

Every record has a package-owned scope and code, a local timestamp, and only
code-defined attributes. Span completion also carries its locally measured
duration. Unknown scopes, codes, lifecycle states, or attributes are rejected
at the receiving package boundary.

Parent spans contain their children. Independent work may overlap and is not
forced into a total order. A cache hit emits the same lifecycle as a miss, with
the cache outcome as a fact. Every started span terminates; work not started
before a failure emits nothing.

The application-side adapter creates any external trace ID. `ceremonyId`,
OAuth state, an action ID, or another protocol correlation value must not be
exported as a trace ID or attribute.

## Measurement catalog

The catalog names measurements, not new public events or CCDP messages. Final
machine codes should remain closed package constants.

### End-to-end and client

| Measurement | Boundaries or facts |
|---|---|
| user-perceived attempt | application activation to accepted, denied, canceled, or failed result |
| OAuth authorization interval | OAuth-platform navigation to cleared callback bootstrap; includes platform and human time |
| post-OAuth machinery | cleared callback bootstrap to accepted proof result or terminal failure |
| prover run | `AppStartProver` to locally validated proof delivery |
| result assembly | proof receipt, exact shape validation, retained-field wrapping, and public result resolution |
| configuration | config fetch, decode, validation, selected platform/version, and failure code |
| ceremony construction | input validation, authorization digest/PKCE work, and frozen configuration |
| launch | popup creation result, callback bootstrap readiness, and OAuth-platform navigation |
| cancellation | request to observed terminal cancellation and close result |

The OAuth authorization interval is reported separately so human consent time never
distorts machinery regressions. Application UI may display both, but automated
performance qualification compares the post-OAuth and proof-request spans.

### Callback ingress

| Measurement | Boundaries or facts |
|---|---|
| callback bootstrap | document start through bounded copy and immediate URL clearing |
| callback initialization | URL clearing through deployment-input validation and entry into the bundled CCDP implementation; there is no callback entry-script fetch |
| proof handoff | authenticated Callback departure through Prover activation and `ProverReady`; measure locally without exporting navigation data |

OAuth query/fragment lengths may be reported only as coarse, code-defined
size buckets. Values, field names supplied by an OAuth platform, and URLs are never
reported.

### Prefetch, cache, and assets

| Measurement | Boundaries or facts |
|---|---|
| service-worker lifecycle | registration, install, activation, control, update, and failure code |
| selected profile | platform/version and immutable release identifier |
| single flight | owner or joiner, work already completed, residual join wait, and terminal result |
| ordinary artifacts | resource-request count, declared bytes, cache hits/misses, single-flight owners/joiners, actual network fetches, transferred bytes, decoded bytes, and duration |
| CRS artifacts | the same aggregate fields, reported separately from ordinary artifacts |
| asset class | code-defined class and logical asset code, never a URL |
| pre-OAuth work | prefetch start through OAuth-platform navigation |
| post-callback join | Prover entry through Prover selected-flight readiness |
| prefetch benefit | work completed before proof start and residual single-flight wait |
| storage health | cache put failure, quota/eviction observation, and stale-release pruning outcome |

Per-asset timings are useful in a manual diagnostics view, but production
export should prefer the aggregates above. Resource Timing names are mapped to
package-owned logical asset codes before leaving the local context.

A resource request is a consumer asking for bytes, not necessarily a download.
Count joiners separately: three requests sharing one uncached flight produce
one network retrieval and two joiners, not three downloads. HTTP-cache and
Service-Worker-cache responses add no network download. Record network activity
where it occurs, including earlier Service Worker prefetch; Prover-local
Resource Timing alone is not a complete total. Missing timing/worker history is
`unavailable`, not zero, and joining or reading cached bytes must not count their
transfer size again.

Prefetch benefit is an estimate of work completed before proving, not a
counterfactual speedup measurement. If its context and worker are both lost
before a later prover can observe the flight, that estimate is `unavailable`, not zero.
Persisting a diagnostic-only prefetch receipt remains an open decision; such a
receipt must be expiring, non-authoritative, contain no ceremony input, and
never affect cache or ceremony behavior.

### Platform and proof engine

The exact platform/version span catalogs and causal rules are owned by
[PROVING.md](../src/prover/docs/proving.md#platform-progress). Diagnostics reuse those codes rather
than create a second list. They include readiness, every Google/X/GitHub
platform step, and the proof-engine phases from worker bootstrap through
backend destruction.

OAuth-return validation is measured locally by Prover from receipt of
`AppStartProver` through accepted return, denial, or malformed-return failure.
It is not a client-side parsing span or a new CCDP lifecycle message.

The prover also reports these bounded facts:

- `crossOriginIsolated`, `SharedArrayBuffer` availability, worker support,
  effective proof thread count, and separately measured TLSNotary pool sizes;
- proof system, platform ceremony version, circuit release, runtime release,
  and SRS profile as package-owned identifiers;
- proof-worker and notary-worker unexpected termination counts;
- memory failure or allocation failure as a stable code, never a raw
  exception; and
- proof, witness, and public-input sizes as bounded byte/count totals, never
  their contents.

Initialization, notarization, witness, and proof durations remain distinct.
For X, session setup overlaps and only the identity request waits for the
token-response bearer. Proof generation may overlap final attestations. Measure
elapsed time from the relevant start/end timestamps, never by summing
overlapping session, initialization, or proof spans.

### Proof delivery and cleanup

Measure proof generation to connection send, connection send to client receipt,
proof-shape validation, retained-field wrapping, application observer delivery,
and connection/context cleanup separately. Record duplicate or late delivery,
discarded result, ignored progress, and close failure as stable counters or
codes.

No diagnostic success precedes local proof-shape validation. Ledger Verifier proof
verification and every post-ceremony application action remain outside this
catalog.
An accepted delivery or a PoC “verified proof” label is not evidence of local
cryptographic verification, which the active proving path does not perform.

### Failure classification

One terminal outcome contains only:

- accepted, denied, canceled, or failed;
- subsystem and stable package error code;
- last active diagnostic span code and elapsed duration;
- whether a fresh OAuth attempt is required;
- whether cleanup completed.

Raw exceptions and stacks may be inspected in a debugger during development.
Package console diagnostics, the package observer, and any OpenTelemetry adapter
receive only the sanitized stable code.

## Privacy and cardinality

Diagnostics must never contain:

- OAuth query, fragment, code, token, verifier, state, credential, or platform
  response;
- ceremony/action/job IDs or operation fields;
- app, callback, OAuth-platform, notary, asset, collector, or worker URLs or origins;
- identity fields or handles;
- request/response headers or bodies;
- attestations, transcripts, commitments, openings, witnesses, public inputs,
  proofs, or keys;
- raw connection internals or transported message values; or
- raw exceptions, stacks, browser-generated error strings, or arbitrary caller
  labels.

Allowed attributes come from closed enums, booleans, bounded integers, package
release identifiers, and coarse size buckets. Capability facts are preferred
over inferred browser brands. Exact browser/device labels belong only in a
user-entered manual qualification report.

Diagnostics are RAM-only by default. The package does not use cookies,
IndexedDB, local storage, or a server job to make telemetry reliable. Sampling
and export retention are application policy. Losing diagnostics during
navigation, suspension, crash, or page close cannot change the ceremony.

## Manual qualification

Automated spans cannot answer every browser UX question. A manual report adds
the tester-supplied browser, OS/device, normal/private mode, popup presentation,
backgrounding behavior, memory warning or termination, OAuth-platform UI outcome,
and whether the user perceived a stall. It attaches the sanitized diagnostic
summary, not credentials or a raw browser log.

Qualification compares at least:

- cold and warm ordinary assets plus CRS;
- prefetch enabled and deliberately unavailable;
- normal and private mode;
- foreground and backgrounded popup;
- popup-connection continuity through Callback-to-Prover navigation;
- one and multiple simultaneous ceremonies; and
- Chromium, Firefox, WebKit, and real iOS Safari.

## Minimum first implementation

The first implementation should expose only:

1. end-to-end, OAuth authorization, post-OAuth, and proof-request spans;
2. callback bootstrap, OAuth parsing, proof handoff, delivery, and ceremony
   cleanup spans, plus the popup package's sanitized connection diagnostics;
3. cache/prefetch aggregates and benefit/residual-wait facts;
4. the existing platform/prover span catalogs;
5. isolation, shared-memory, thread-count, release, and worker-failure facts;
6. sanitized terminal outcomes; and
7. one application observer which may be adapted to OpenTelemetry.

Automatic browser instrumentation, an OTLP endpoint in popup/prover, a second
Metrics SDK pipeline, durable telemetry, and a package-owned collector are not
part of the first implementation.
