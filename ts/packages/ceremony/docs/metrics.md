# Events and measurements

The [client subscriptions](client.md#events-and-presentation) and popup UI consume
one operation feed. Core event meanings and readiness consequences belong to
[CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md#event).
There is no separate metrics-record format or telemetry SDK in the documents.
Application owns export, sampling, consent and retention. Full resource accounting
and export are deferred; this guide preserves their required measurement rules.

## Producers and presentation

[events.ts](../src/events.ts) owns occurrences, subscriptions, terminal status and
monotonic stage projection. [Barretenberg events](../src/barretenberg/events.ts)
and each platform's `events.ts` own additional operations and separate progress
weights. Pipeline producers use `operation()` or explicit start/finish emission
around concurrent branches. Failed operations need not fabricate a finish.

Popup UI uses that local feed without an Application roundtrip. Its native bar
counts selected completed operations once, including cache hits; nested parent
operations add no duplicate work. Weights are work estimates, not elapsed-time
percentages. [progress.ts](../src/ccdp/documents/progress.ts) owns accounting and
[ui.ts](../src/ccdp/documents/ui.ts) owns presentation and the bounded paint
opportunity before delivery. A full bar/local delivery cannot claim Client
acceptance. The application may close immediately on the accepted result.

## Timing

Events carry producer occurrence timestamps in epoch milliseconds, including
through workers and retrospective forwarding. Repeated overlapping extension
operations use `instrumentation.operationId` for pairing; core operations occur
once. A phase-less observation is not a span. `prover-fallback` is the only
phase-less core event.

- Total duration: `prefetch-dispatch.started` to the terminal client update.
- Post-authorization waiting: `authorization.finished` to the terminal update.
  Callback emits that boundary after capture/clearing and authentication; it
  does not measure the instant the user clicked consent.
- Fallback interval: replacement navigation's `performance.timeOrigin`, reported
  as `prover-fallback`, through `prover.started`. It excludes pre-navigation source
  work and is not a counterfactual extra-cost measurement.
- Interrupted/missing intervals are unavailable, not zero. Never sum overlapping
  preparation, witness and attestation spans as elapsed time. Stages describe
  presentation, not an exclusive execution waterfall.

### Prefetch breakdown

`prefetch-dispatch.finished` carries four durations in `instrumentation.attributes`:

- `document-startup-ms`: navigation start to Prefetch entry execution, including
  document/module loading and evaluation; not the browser's `load` event.
- `connection-ms`: entry execution through authenticated popup readiness.
- `worker-ready-ms`: root Worker registration, activation and stale nested-registration cleanup.
- `dispatch-ms`: request to Worker dispatch acknowledgement, including cache lookups
  and any cached CRS body reads currently needed before acknowledgement.

These consecutive intervals use the Prefetch document's monotonic clock. They
exclude Application work before navigation, and do not measure asset download
completion or proving initialization. The dev app displays them in the existing
Prefetch operation's collapsed details. They identify the wait's location without
claiming whether it came from disk, worker startup or network activity.

## Resource accounting

Distinguish a resource request, an actual network download and a single-flight
joiner. Several requests can share one retrieval; a cached response is not a
new download. Attribute earlier Service Worker downloads where they occurred,
without counting them again when Prover joins. Missing earlier observations
remain unavailable.

A native fetch call may reuse HTTP cache, so counting calls does not establish
network traffic or transferred bytes. Use observed transfer data where the
browser and resource policy expose it. The current feed does not claim complete
coverage; [traceability](traceability.md) retains those gaps.

## Export boundary

Instrumentation contains bounded scalar attributes, not arbitrary diagnostic
payloads. Exclude credentials, identity data, callback parameters, proofs,
witnesses, attestations, transcripts and raw exceptions. Do not use URLs, origins,
user IDs or error text as metric labels. Export selected fields rather than
copying an entire event.

A failed or closed lifecycle update includes bounded opaque display text and operation
context. Bounding text is not credential redaction; omit `message` and retained
local causes from telemetry. Undeliverable failure reporting uses a fixed local
diagnostic. Logger, UI and observer errors cannot create another protocol failure
or suppress readiness. Only Client acceptance of `IdentityProof` creates the
completed lifecycle update.
