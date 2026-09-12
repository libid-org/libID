# Browser document entrypoints

[CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md#documents-and-routes) owns routes, fragments, roles, and
navigation order. The [Distribution specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md)
owns their observable response policies. These modules implement those contracts;
they do not implement popup authentication, carrier selection, or continuity.

## Implementation guide

| Entry | Implementation responsibility |
|---|---|
| [callback.ts](../src/ccdp/documents/callback.ts) | Capture/clear the return, select bundled CCDP code, validate Bridge inputs, authenticate Application, and navigate privately to Prover. |
| [prefetch.ts](../src/ccdp/documents/prefetch.ts) | Run the Prefetch document or install the shared Worker handlers, depending on execution context. |
| [prover.ts](../src/ccdp/documents/prover.ts) | Accept the retained capture and connection, dispatch the selected lazy platform pipeline, and deliver events and one outcome. |
| [ui.ts](../src/ccdp/documents/ui.ts) | Native document UI, shared event subscription, and slow-proving notice. |

### Callback

The self-contained artifact starts before other browser work, bounds and copies
the URL components, and clears the location. Its closed version dispatcher
selects code already bundled in the HTML. Unsupported versions show a local
error without importing another script or requiring an obsolete transport.

The Bridge inserts only deployment data. Callback validates and freezes it,
accepts a connection, reports authorization return, then navigates using its
private capture. It installs no Worker and never parses the platform outcome.
The pending exact-origin handoff is recorded in
[qualification](qualification.md#pending-contract-updates); current code still
authenticates on Callback without carrying that restriction to Prover.

### Prefetch and Worker

Prefetch accepts its connection before reporting dispatch. It uses the lightweight
asset catalog, not platform execution imports. Worker setup and selected-profile
dispatch finish before Authorization starts; downloads need not finish.

The dual-context entry composes ceremony asset fetching with popup's exported
keeper handler. [The asset guide](prefetch.md) owns pending-fetch joins, caches,
root registration selection, and restart behavior. Initialized proving engines
and TLSN sessions are not preserved across OAuth.

### Prover

Prover passes its captured fragment and root Worker scope into popup construction,
and supplies the same-origin isolation fallback URL. Popup completes any
replacement before exposing readiness. Prover registers handlers, awaits the
connection and canonical root-worker claim, checks shared-memory/worker support,
then reports readiness. This avoids a protocol-level isolation branch or another
proving window.

Platform pipelines are lazy imports. A shared AbortController tears down reachable
work; terminal processing clears retained credentials, listeners, workers, and UI
timers. Neither delivery nor failure closes or navigates the popup: Application
owns subsequent use of the supplied connection.

### Presentation

Every view includes an inline libID logo. Prover uses an accessible, indeterminate
native progress bar and the shared sequential stage projection; it reports
`Proof delivered` locally, not Application acceptance. After 15 seconds, a
nonblocking slow-proving notice may suggest enabling JavaScript JIT in Vanadium.
There is no ETA, styling API, Application markup, or renderer injection.

The local event subscription does not wait for a roundtrip to Application.
Opaque errors are rendered as text. UI/observer failure cannot change a protocol
outcome or suppress required sends.
