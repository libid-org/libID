# Ceremony measurements

The [operation event feed](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md#event) is the input for UI, debugging,
tracing and metrics. There is no second metrics-record format. Core meanings and
protocol consequences belong to CCDP; the [client guide](client.md#progress-cancellation-and-recovery)
defines public subscriptions and the stage projection.

## Collection boundary

Application owns export, sampling, consent and retention. It may adapt `onEvent`
to its existing recorder or tracing library; no telemetry SDK, collector URL or
export configuration belongs in popup documents. Documents can observe their own
local feed without waiting for Application scheduling. Observer exceptions and
filtering never suppress protocol processing or required readiness sends.

Protocol observations do not grant additional authority. Only accepted
`IdentityProof` delivery gives the client a completed ceremony. A document that
has sent its proof cannot claim that Application accepted it.

## Spans and observations

An operation's `started` and `finished` occurrences form a span using their
original epoch-millisecond timestamps. Core operations occur once per ceremony.
Repeated extension operations that can overlap use `operationId` to pair their
occurrences. It is an instrumentation identifier, never a protocol credential.
Phase-less extension observations are valid; `prover-fallback` is the only
phase-less core event. Interrupted spans need no fabricated finish.

`attributes` carries bounded scalar measurements and coarse facts. Producers
choose code-owned names and values; transport limits do not make arbitrary data
safe to export. Exclude credentials, identity data, callback parameters, proofs,
witnesses, attestations, transcripts and raw exceptions. Do not use URLs, origins,
user IDs or error text as attribute values or metric labels.

The current proof engine emits its fine-grained operations through this same
feed; see [the proving events](proving.md#operation-events). The development app
shows operation durations, overall outcome and post-authorization waiting time.
Full resource/cache accounting and a telemetry exporter remain deferred; a missing
measurement must not be filled with a plausible number.

## Timing and accounting

- Total ceremony duration runs from `prefetch-dispatch.started` to the client’s
  terminal update. There is no separate root ceremony event.
- Post-authorization waiting runs from `authorization.finished` to that terminal
  update. Callback records this after capture/clearing and authentication; it is
  not a direct measurement of the instant the user clicked consent. If that
  observation is unavailable, so is the interval.
- `prover.started` minus `prover-fallback` measures the replacement document’s
  navigation through Prover readiness. It excludes source-document work and does
  not estimate the extra cost relative to successful direct isolation.
- Backend/input preparation, witness execution and attestation work may overlap.
  Do not sum those spans as elapsed time or infer an exclusive stage waterfall.
- Distinguish resource requests, actual network downloads and single-flight
  joiners. Three concurrent requests can produce one retrieval and two joiners;
  serving a cached response is no new download.
- Attribute downloads to where they occurred, including earlier Service Worker
  fetching. A later Prover join must not count the bytes or duration again.
  Missing earlier-worker observations are unavailable, not zero.
- A native `fetch` invocation may hit the browser HTTP cache. Invocation counts
  alone do not establish network-download counts or transferred bytes. Resource
  Timing may supply those details where available and permitted by the response.

Retrospective delivery preserves timestamps. Consumers can order a display by
occurrence, but must not reorder protocol processing or invent a globally
sequential execution order from concurrent work.

## Failure details and telemetry

`Abort` and local failures yield one terminal lifecycle update with operation
context and display text. They are separate from wire `Event`; a failed operation
need not have emitted its start. Cancellation and denial also terminate the
ceremony without fabricating `prover.finished`.

The display text follows [Abort’s boundary](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md#abort): a bounded opaque
caught message, not an error-code catalog or serialized exception. It can help
debug failures such as `Invalid GitHub id`. Bounding and rendering it as text do
not guarantee that dependency messages contain no sensitive data. Telemetry
adapters must omit `message` and any local exception/cause; copying all fields
from `onEvent` into an exporter is not supported.

If Abort cannot be delivered, reporting emits a fixed local diagnostic without
the caught message. A failing logger or observer never creates another protocol
failure. DevTools can inspect a retained local cause where needed; there is no
package-owned developer modal or automatic raw-error export.

## Qualification

Focused checks exercise timestamp preservation, concurrent operation pairing,
interrupted spans, monotonic stages, observer independence, and exactly one
terminal update before promise settlement. Browser checks use the actual popup
transport. Mocked events establish presentation and coordination behavior, not
proof generation, live TLSNotary concurrency or physical-device behavior.

[The requirement index](test-plan.md) and [traceability](traceability.md) retain
those distinctions and the deferred resource-accounting coverage.
