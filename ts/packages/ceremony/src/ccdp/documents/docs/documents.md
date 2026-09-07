# CCDP documents and navigation

## Documents and Routes

**Resources** collectively means Prefetch, Callback, Prover, and
Worker. Authorization is an external document, not a CCDP resource.

### Prefetch `GET /prefetch`

| Property | Contract |
|---|---|
| Parameters | <table><tr><th>Name</th><td><code>#ceremonyId</code></td><td><code>#platformId</code></td><td><code>#ceremonyVersion</code></td></tr><tr><th>Values</th><td>lowercase UUIDv4</td><td>exact identifier from the selected platform profile</td><td>unsigned 16-bit platform ceremony version</td></tr></table> |
| Location and context | CCDP origin; versioned, top-level, and non-isolated ceremony-popup document |
| Role | Starts the selected profile's fetches before the Application continues through [Prefetch to Authorization](../../docs/protocol.md#1-prefetch-to-authorization). It receives no authorization URL, OAuth return, or proof input. |

### Authorization `GET platformAuthorizationUrl`

| Property | Contract |
|---|---|
| Parameters | The complete frozen URL is opaque to CCDP. The selected platform ceremony version owns its parameters. |
| Location and context | Selected OAuth Platform; top-level ceremony-popup document |
| Role | Owns login and consent during [Authorization to Callback](../../docs/protocol.md#2-authorization-to-callback). No CCDP participant runs and no CCDP message or popup connection is exposed to this document. |
| External policy | Controlled entirely by the OAuth Platform. CCDP assumes nothing about its markup, scripts, headers, or origin transitions; it may sever the opener or browsing-context group. Callback reconnects without assuming direct window continuity. The selected platform ceremony version owns authorization request and return semantics. |

### Callback `GET redirectUri`

| Property | Contract |
|---|---|
| Location and context | OAuth Bridge origin at its configured registered callback path, default `/auth/callback`; top-level, non-isolated document with complete bundled Callback code and bridge-owned deployment inputs |
| Role | Authenticates the Application during [Authorization to Callback](../../docs/protocol.md#2-authorization-to-callback), then privately carries the captured OAuth return in popup navigation to Prover during [Callback to Prover](../../docs/protocol.md#3-callback-to-prover). It installs no Service Worker, retains no state across navigation, and does not classify, prefetch, prove, verify, persist a checkpoint, or close the popup. |
| Presentation and cleanup | Renders fixed transition and failure views with an inline libID logo and accepts no Application markup or renderer. Terminal cleanup clears retained OAuth-return bytes, removes listeners, and releases unneeded references. Failure before connection acceptance is rendered locally and cannot release the return; observable failure after acceptance uses `AbortCeremony`. |

### Prover `GET /prover`

| Property | Contract |
|---|---|
| Parameters | <table><tr><th>Name</th><td><code>#ceremonyId</code></td><td><code>#oauthQuery</code></td><td><code>#oauthFragment</code></td></tr><tr><th>Values</th><td>lowercase UUIDv4</td><td>captured OAuth query, including leading <code>?</code> when nonempty</td><td>captured OAuth fragment, including leading <code>#</code> when nonempty</td></tr></table> |
| Location and context | CCDP origin; versioned, top-level ceremony-popup participant; cross-origin isolated before protocol readiness |
| Role | Accepts the logical Application connection during [Callback to Prover](../../docs/protocol.md#3-callback-to-prover), then validates the retained OAuth return under the Application-selected profile and runs [Prover execution](../../docs/protocol.md#4-prover-execution). [PROVING.md](../../../prover/docs/proving.md) defines proof-generation pipelines, asset use, notarization, and caching. |
| Presentation and cleanup | Renders a persistent inline libID logo and one accessible milestone progress bar. It begins at **Preparing proof**, advances only from valid platform events, and reaches 100% only on proof delivery. After `SLOW_PROVING_HINT_MS = 15_000`, it adds a nonblocking **Still proving** notice which may suggest enabling JavaScript JIT in Vanadium site controls. It accepts no Application markup or renderer, presents no ETA, and clears inputs, workers, timers, and listeners without closing or navigating the popup. |

### Worker `GET /worker.js`

| Property | Contract |
|---|---|
| Location and context | CCDP origin; same-origin module Service Worker whose response sets `Service-Worker-Allowed: /` and which Prefetch registers with `scope: '/'` |
| Role | Composes MessagePort continuity across same-origin participating documents with asset and CRS single flights and caches for Prefetch and Prover. It remains compatible with every live CCDP version and passes requests outside its pinned resource graph to the network unchanged. |

### Common

#### Paths and versioning

Prefetch, Prover, and Worker routes are relative to
`{ccdpOrigin}/ccdp/v{CCDPVersion}`. Callback executes at the frozen `redirectUri`
on the OAuth Bridge origin; the Distribution defines the public artifact the
bridge retrieves to serve it. Authorization is the external frozen
`platformAuthorizationUrl`, not a CCDP route.

Before launch, the Application freezes the CCDP origin, redirect URI, platform
authorization URL, ceremony ID, platform ID, and platform ceremony version.
This document defines `CCDPVersion = 1`. The Application selects it in the
Prefetch path, carries the same version through OAuth `state`, and uses the
matching Prover path. Callback selects its bundled implementation from that
state; fragments and messages do not repeat the version. Google returns state
in the fragment, so the bridge cannot perform this selection at HTTP ingress.

Compatible implementation changes keep the version. A breaking fragment
grammar, navigation order, message shape, direction, ordering, or validation
rule increments it, publishes new CCDP paths and Worker, and adds that version's
implementation to the self-contained Callback artifact. Old resources and
bundled Callback implementations remain available for live ceremonies and a
compatibility window.

Once that window ends, a build may omit a retired Callback implementation.
Its version then takes Callback's local unsupported-version error path before
connection setup, rather than requiring an older transport or error protocol.
The popup owns that error display; it never falls forward to a different CCDP
version or reports this failure as OAuth denial.

A later CCDP version substitutes its decimal version in the common path. The
registered callback URL stays fixed: its document includes a closed set of
supported implementations and enters the selected one directly. All browser
documents execute embedded entry code. Internal bundle names are not protocol
surface; obtaining Callback bytes from the Distribution does not change its
OAuth Bridge execution origin.

The Prefetch and Prover paths select both CCDP version and document
role.

Platform Ceremony Version independently versions one platform's authorization,
OAuth, proof, and output semantics. Popup connection controls and the OAuth
Bridge API are independently versioned as well.

#### Popup and fragment model

The **ceremony popup** is a reusable browsing context, not an actor or
document. It sequentially contains Prefetch → Authorization → Callback →
Prover. Navigation creates a new JavaScript heap each time; no
participant relies on document-local state surviving it. These origins may all
be cross-site, and same-site placement grants no protocol authority.

Internal fragments use URL-search-parameter encoding after `#`. Producers emit
each named field exactly once in the displayed order. Receivers require the
exact field set, reject duplicates, and otherwise do not depend on parameter
order.

The Prefetch and Prover routes have no query. Their fragments are never sent
in HTTP requests and are copied and cleared before rendering, storage, or
network use. Prover's `oauthQuery` and `oauthFragment` are the sole internal
credential-bearing navigation fields. They preserve the original two URL
components separately, including empty values, with one outer
URL-search-parameter encoding layer; decoding that layer reproduces the
captured components without normalization or merging. The selected profile's
OAuth parser handles their contents later.

Callback constructs this fragment locally for the frozen CCDP-origin Prover;
the Application receives neither the return nor the navigation target.
The Prover captures and clears it before use. Any internal isolation
replacement preserves the captured fragment and clears it again on arrival.
No return enters a request query, connection notification, signaling record,
Worker record, telemetry, or error. Proofs and other proving inputs never enter
navigation fragments. The OAuth-platform-mandated query on `redirectUri`
remains the sole credential-bearing HTTP-request URL.

CCDP is connection-neutral. It defines which document runs at each location,
which participant initiates each navigation, what each message means, and their
order. Each recipient validates its permitted inbound messages and enforces
direction and state before acting.

#### Origin policy

Because one CCDP Distribution serves Applications admitted by any number of
independent OAuth Bridges, Prefetch and Prover use
`allowedApplicationOrigins: '*'`. They accept any valid browser-observed HTTPS
Application origin and pin that exact origin and source for each carrier, while
the Application exact-authenticates the configured CCDP origin. Open admission
grants only public asset prefetch, carrier continuity, and processing of the
connecting Application's own proof request. Prover receives the captured return
from Callback, not directly from the platform. Callback exact-authenticates the
Application against its containing OAuth Bridge's explicit deployment
allowlist before navigating with that return to the configured CCDP origin.
The public Callback artifact contains no Bridge policy; the serving Bridge
inserts its trusted configuration. Server-side artifact retrieval does not
replace Callback's credential-release check. Asset caching and popup-connection
construction are outside CCDP.
