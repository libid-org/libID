# Ceremony Cross-Document Protocol (CCDP)

This document defines the closed browser protocol across the Application and
the [documents](#documents-and-routes) it uses. It owns ceremony locations,
navigations, messages, ordering, and compatibility. Authorization,
platform-proof, and final-proof semantics are defined by the normative
[common ceremony](../../../specs/ceremony-common.md) and
[platform ceremony](../../../specs/platform-ceremonies.md) specifications.

An authenticated, ordered, bidirectional popup connection carries CCDP
messages unchanged. CCDP requires that connection but does not prescribe its
implementation. [CCDP_DISTRIBUTION.md](CCDP_DISTRIBUTION.md) defines the static
distribution and HTTP contract for the CCDP origin.

## Actors and origins

An actor is an operator or external system. An origin is the exact
scheme/host/port authority used by browser security checks. A site is only the
browser's schemeful registrable-domain grouping: same-site actors may remain
cross-origin and do not gain authority over each other.
`Application` denotes both the actor and its top-level browser document when
the distinction is immaterial.

| Actor | Browser authority | Responsibility |
|---|---|---|
| Application | application origin | hosts the application document, owns the operation and ceremony state, and drives the protocol |
| OAuth Bridge | OAuth bridge origin | publishes ceremony configuration, hosts the callback shell, owns OAuth registrations, and performs enabled confidential OAuth exchanges |
| CCDP Distribution | CCDP origin | contains the versioned [resources](#documents-and-routes) and proving assets used by any number of OAuth Bridges; it may be the canonical libID distribution or an operator-selected replacement |
| OAuth Platform | OAuth-platform origin set | hosts authorization/login documents and issues the OAuth return |

The Application and OAuth Bridge may be operated together or independently;
the selected CCDP Distribution may be published by either party or another
one. Their origins may be same-origin, same-site, or cross-site. CCDP assumes
none of those relationships. Browser authority is always established against
an exact origin. A composition which continues the live popup connection after
CCDP has the additional requirements below.

The OAuth Bridge owns the registered callback shell because the OAuth redirect
URI must terminate on the bridge origin. After clearing the OAuth return, that
shell dynamically loads CCDP's versioned Callback module from the configured
CCDP origin.

Multiple independently operated OAuth Bridges may select the same CCDP
Distribution through its `ccdpOrigin`. The Distribution keeps no Bridge
registry or reciprocal allowlist and exposes identical public CCDP resources
across that relationship.

## Composition boundary

CCDP does not define documents, messages, or policy outside the ceremony. A
composition may use the same popup and connection before or after CCDP, but
those steps remain outside this protocol.

Carrying the live connection beyond Prover requires the next document to use
the exact CCDP origin; same-site placement is insufficient. All code on that
origin shares one browser authority and must therefore be mutually trusted.

## Documents and Routes

**Resources** collectively means Prefetch, Callback, Prover, and
Worker. Authorization is an external document, not a CCDP resource.

### Prefetch `GET /prefetch`

| Property | Contract |
|---|---|
| Parameters | <table><tr><th>Name</th><td><code>#ceremonyId</code></td><td><code>#platformId</code></td><td><code>#ceremonyVersion</code></td></tr><tr><th>Values</th><td>lowercase UUIDv4</td><td>exact identifier from the selected platform profile</td><td>unsigned 16-bit platform ceremony version</td></tr></table> |
| Location and context | CCDP origin; versioned, top-level, and non-isolated ceremony-popup document |
| Role | Starts the selected profile's fetches before the Application continues through [Prefetch to Authorization](#1-prefetch-to-authorization). It receives no authorization URL, OAuth return, or proof input. |

### Authorization `GET platformAuthorizationUrl`

| Property | Contract |
|---|---|
| Parameters | The complete frozen URL is opaque to CCDP. The selected platform ceremony version owns its parameters. |
| Location and context | Selected OAuth Platform; top-level ceremony-popup document |
| Role | Owns login and consent during [Authorization to Callback](#2-authorization-to-callback). No CCDP participant runs and no CCDP message or popup connection is exposed to this document. |
| External policy | Controlled entirely by the OAuth Platform. CCDP assumes nothing about its markup, scripts, headers, or origin transitions; it may sever the opener or browsing-context group. Callback reconnects without assuming direct window continuity. The selected platform ceremony version owns authorization request and return semantics. |

### Callback `GET /callback.js`

| Property | Contract |
|---|---|
| Location and context | CCDP origin; versioned, cross-origin-loadable module dynamically loaded into the OAuth Bridge's top-level, non-isolated callback shell |
| Role | Authenticates the Application during [Authorization to Callback](#2-authorization-to-callback), then privately carries the captured OAuth return in popup navigation to Prover during [Callback to Prover](#3-callback-to-prover). It installs no Service Worker, retains no state across navigation, and does not classify, prefetch, prove, verify, persist a checkpoint, or close the popup. |
| Presentation and cleanup | Renders fixed transition and failure views with an inline libID logo and accepts no Application markup or renderer. Terminal cleanup clears retained OAuth-return bytes, removes listeners, and releases unneeded references. Failure before connection acceptance is rendered locally and cannot release the return; observable failure after acceptance uses `AbortCeremony`. |

### Prover `GET /prover`

| Property | Contract |
|---|---|
| Parameters | <table><tr><th>Name</th><td><code>#ceremonyId</code></td><td><code>#oauthQuery</code></td><td><code>#oauthFragment</code></td></tr><tr><th>Values</th><td>lowercase UUIDv4</td><td>captured OAuth query, including leading <code>?</code> when nonempty</td><td>captured OAuth fragment, including leading <code>#</code> when nonempty</td></tr></table> |
| Location and context | CCDP origin; versioned, top-level ceremony-popup participant; cross-origin isolated before protocol readiness |
| Role | Accepts the logical Application connection during [Callback to Prover](#3-callback-to-prover), then validates the retained OAuth return under the Application-selected profile and runs [Prover execution](#4-prover-execution). [PROVING.md](PROVING.md) defines proof-generation pipelines, asset use, notarization, and caching. |
| Presentation and cleanup | Renders a persistent inline libID logo and one accessible milestone progress bar. It begins at **Preparing proof**, advances only from valid platform events, and reaches 100% only on proof delivery. After `SLOW_PROVING_HINT_MS = 15_000`, it adds a nonblocking **Still proving** notice which may suggest enabling JavaScript JIT in Vanadium site controls. It accepts no Application markup or renderer, presents no ETA, and clears inputs, workers, timers, and listeners without closing or navigating the popup. |

### Worker `GET /worker.js`

| Property | Contract |
|---|---|
| Location and context | CCDP origin; same-origin module Service Worker whose response sets `Service-Worker-Allowed: /` and which Prefetch registers with `scope: '/'` |
| Role | Composes MessagePort continuity across same-origin participating documents with asset and CRS single flights and caches for Prefetch and Prover. It remains compatible with every live CCDP version and passes requests outside its pinned resource graph to the network unchanged. |

### Common

#### Paths and versioning

The CCDP routes above are relative to `/ccdp/v{CCDPVersion}`. All
[resources](#documents-and-routes) resolve against `ccdpOrigin`.
Authorization is the external frozen
`platformAuthorizationUrl`, not a CCDP route.

Before launch, the Application freezes the CCDP origin, redirect URI, platform
authorization URL, ceremony ID, platform ID, and platform ceremony version.
This document defines `CCDPVersion = 1`. The Application selects it in the
Prefetch path, carries the same version through OAuth `state`, and uses the
matching Prover path. Callback selects its implementation from that
state; fragments and messages do not repeat the version.

Compatible implementation changes keep the version. A breaking fragment
grammar, navigation order, message shape, direction, ordering, or validation
rule increments it, publishes new CCDP paths and Worker, and adds the
Callback version to the OAuth Bridge shell's closed supported-version map. Old
resources remain available for live ceremonies and a compatibility window.

A later CCDP version substitutes its decimal version in the common path. The
OAuth Bridge dynamically loads the matching Callback module from the CCDP
origin; the top-level [resources](#documents-and-routes) execute their
implementations directly. Internal bundle names are not protocol surface. All
[resources](#documents-and-routes) share the CCDP origin.

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
The public Callback module is
cross-origin-loadable from the CCDP origin, but that resource policy does not
replace Callback's credential-release check. Asset caching and popup-connection
construction are outside CCDP.

## Messages

The following table is the complete CCDP version-1 message set.

| Message | Direction | Accepted after | Cardinality and effect |
|---|---|---|---|
| [`PrefetchStarted`](#prefetchstarted) | Prefetch → Application | connection acceptance and selected-profile dispatch | exactly once; permits navigation to Authorization |
| [`ProverReady`](#proverready) | Prover → Application | Prover connection acceptance and cross-origin isolation | exactly once; permits `AppStartProver` |
| [`AppStartProver`](#appstartprover) | Application → Prover | `ProverReady` | exactly once; selects the profile for OAuth validation and proof execution |
| [`ProverNotifyEvent`](#provernotifyevent) | Prover → Application | `AppStartProver` and valid OAuth acceptance | zero or more; advisory only |
| [`ProverDeliverProof`](#proverdeliverproof) | Prover → Application | `AppStartProver` and valid OAuth acceptance | at most once; ends the Prover run |
| [`CancelCeremony`](#cancelceremony) | Application → Callback or Prover; Prover → Application | active connection for Application cancellation; `AppStartProver` and valid OAuth denial for Prover cancellation | at most once; ends the run without a technical error |
| [`AbortCeremony`](#abortceremony) | Prefetch, Callback, or Prover → Application | connection acceptance | at most once; reports technical failure and ends the run |

Every recipient requires a plain record with the exact fields, types, and bounds
defined below. Unknown fields, coercion, normalization, defaults, and
unrecognized discriminators are invalid. Messages outside the listed direction,
predecessor, and cardinality are invalid. Cancellation, proof delivery, and
abort make later messages inert even when they race in transit.

### PrefetchStarted

```ts
interface PrefetchStarted {
  type: 'prefetch-started'
}
```

`PrefetchStarted` states only that fetching for the selected public profile
was dispatched. It does not promise completion or grant authority. Prefetch
already received the profile through its cleared fragment, so the message
repeats no selection field.

### ProverReady

```ts
interface ProverReady {
  type: 'prover-ready'
}
```

`ProverReady` states only that Prover accepted the Application connection,
established cross-origin isolation, and installed its CCDP handlers. It carries
no correlation or profile field and does not imply that proving started.
The Application sends `AppStartProver` only after accepting this message.
Readiness does not classify the retained OAuth return as approval or denial.

### AppStartProver

```ts
interface AppStartProver {
  type: 'app-start-prover'
  platformId: string
  platformCeremonyVersion: number
  clientId: string
  redirectUri: string
  codeVerifier: string | null
}
```

`platformId` and `platformCeremonyVersion` are the exact supported profile
selected at launch and must match the active Prover. The message is valid only
after `ProverReady`. The remaining fields are the frozen client identifier and
redirect and derived code verifier. The OAuth return is already retained by
Prover and is not repeated in the message. Starting Prover initiates OAuth
validation; it does not assert acceptance or mean that proof generation has
already begun.

The Application origin is trusted for this transient input because it already
supplies the operation being authorized. It retains the authorization nonce;
only the derived code verifier crosses this boundary. The message contains no
authorization digest, operation field, separate OAuth state, Job revision,
composition state, connector, or carrier kind.

For GitHub, Prover derives the fixed OAuth Bridge token route from the origin of
`redirectUri`; no second bridge origin or endpoint field is carried. Prover
exact-validates the CCDP record and selected platform/version before credential
use. That profile parses the retained query/fragment pair, enforcing exact
transport, fields, client/redirect checks applicable to the response, and
success/denial grammar. It matches OAuth `state` to
`v<CCDPVersion>.<ceremonyId>` using the versioned resource and the ID of the
authenticated logical connection, not a second caller-selected expected state.
The return is consumed once; no second request or replacement response can
restart the run.

### ProverNotifyEvent

```ts
interface ProverNotifyEvent {
  type: 'prover-notify-event'
  platformStep: {
    code: string
    label: string
    status: 'started' | 'completed' | 'failed'
    progress: number
  }
  timestamp: number
}
```

`platformStep.code` belongs to the selected platform ceremony version's closed
step set. `label` is nonempty display text of at most 96 UTF-8 bytes without
control characters. `status` records the step transition. `progress` is
finite, monotonic, and in `[0, 1)`. `timestamp` is the Prover's finite,
nonnegative `performance.timeOrigin + performance.now()` value in milliseconds.
It permits same-browser ordering and duration diagnostics but grants no
authority.

### ProverDeliverProof

```ts
interface ProverDeliverProof {
  type: 'prover-deliver-proof'
  proof: unknown
}
```

`proof` is the exact value defined by the selected platform ceremony version.
CCDP treats it as opaque and the selected platform validator checks it; adding a
platform does not change this message.

### CancelCeremony

```ts
interface CancelCeremony {
  type: 'cancel-ceremony'
}
```

`CancelCeremony` is a parameterless, bidirectional terminal message:

- Application → Callback or Prover stops reachable work after explicit
  cancellation or retirement of Application authority.
- Prover → Application reports only a valid, ceremony-bound OAuth-platform
  denial discovered while validating `AppStartProver`. The Application
  resolves `{ status: 'denied' }`. Prover sends it before token exchange,
  proof execution, or platform progress, never as a substitute for a failure.

Malformed, mismatched, or otherwise invalid OAuth returns use
`AbortCeremony`, not cancellation. An Application which has already canceled
ignores a racing denial or proof. Cancellation has no acknowledgement;
recipients clear reachable input but do not close or navigate the popup.

### AbortCeremony

```ts
interface AbortCeremony {
  type: 'abort-ceremony'
  reason: string
}
```

`AbortCeremony` reports an observable technical failure after connection
acceptance from whichever of Prefetch, Callback, or Prover is active. `reason` is
a bounded sanitized diagnostic string, not a stable code or raw exception.
Exact reason enums may emerge from implementation experience. The Application
rejects the live ceremony. Failure before connection acceptance has no CCDP
path and remains local.

## Protocol

The protocol advances one named ceremony popup through
[Prefetch](#prefetch-get-prefetch),
[Authorization](#authorization-get-platformauthorizationurl),
[Callback](#callback-get-callbackjs), and
[Prover](#prover-get-prover). Those route sections own each participant's
inputs, context, and role; [Messages](#messages) owns the records crossing the
popup connection. The phases below own their sequencing, entry conditions, and
exit conditions. Navigation retires the source document, and no later message
can reactivate an earlier phase.

### Invariants

- One live ceremony owns one authenticated popup connection. Connection
  ownership supplies message correlation and its private version; loaded
  resources supply the CCDP version. CCDP messages repeat neither.
- Each participant accepts only exact records permitted by its direction,
  current state, and cardinality. Unknown, malformed, replayed, out-of-order,
  wrong-direction, and post-terminal values change no state.
- Browser-observed exact origins establish authority. Same-site placement,
  navigation history, request headers, and message fields do not substitute for
  connection authentication.
- Documents use only the frozen locations and fragments defined here. A CCDP
  message never selects an origin, implementation, or navigation destination.
- Raw OAuth returns pass only from the cleared Callback capture to Prover's
  private fragment, including any isolation replacement. Every arrival clears
  its URL before use; no intermediate store, notification, or diagnostic
  receives those values. The platform-mandated callback query is the sole
  HTTP-request ingress exception.
- Callback carries the return onward only after authenticating the Application.
  Prover validates it against the authenticated ceremony and selected profile
  before any credential-bearing request. Application receives only protocol
  outcomes and the final proof, whose evidence may contain profile-required
  disclosed fields. Authorization receives no CCDP message or connection.
- Progress, carrier state, navigation, popup closure, and unvalidated proof
  delivery grant no authority and never constitute ceremony success.
- The Application owns terminal popup lifetime. No CCDP document closes the
  popup.
- Cancellation and context-loss cleanup are best effort. CCDP has no durable
  checkpoint, ceremony recovery, or migration to another popup connection.

### Phases

#### 1. Prefetch to Authorization

The protocol enters this phase on user activation. The Application initiates
one named popup's first navigation to [Prefetch](#prefetch-get-prefetch) and
establishes its connection there. A scripted opener may first reserve the
popup at `about:blank`; if that fails, the same activation's real anchor
navigates it directly to Prefetch.

Prefetch clears and validates its fragment, accepts the connection, registers
the Worker, and dispatches the selected profile's fetches. It then sends
[`PrefetchStarted`](#prefetchstarted). Only after accepting that message, the
Application endpoint navigates the retained popup to
[Authorization](#authorization-get-platformauthorizationurl) at the frozen
`platformAuthorizationUrl`. The Application owns this transition because it
alone retains that URL; neither the URL nor a navigation command crosses the
carrier. Authorization is not a participating document, so the navigation
retires the Prefetch carrier while leaving the Application endpoint available
for Callback.

Worker registration, activation, or selected-profile dispatch failure after
connection acceptance sends `AbortCeremony` instead of `PrefetchStarted`;
Application rejects without navigating to Authorization. Download failure
after successful dispatch remains an asset-cache concern and uses the normal
cold-fetch path, not a late Prefetch abort. Failures before connection acceptance
are reported locally and release no protocol message.

#### 2. Authorization to Callback

This phase begins when [Authorization](#authorization-get-platformauthorizationurl)
loads. The OAuth Platform owns the popup and initiates browser navigation to
the frozen `redirectUri` after approval or denial; neither CCDP endpoint
initiates that transition. The OAuth Bridge shell captures and clears the
return, selects the CCDP version from `state`, and dynamically imports the
matching [Callback](#callback-get-callbackjs) module in the same document. The
[OAuth Bridge contract](OAUTH_BRIDGE.md#callback-document) exclusively defines
ingress.

Callback accepts the Application connection using the ceremony ID extracted
from the captured `state`. This authenticates the Application against the
Bridge's deployment allowlist before the return can leave Callback. It sends
no OAuth-return message. Connection acceptance permits the Prover transition.

#### 3. Callback to Prover

The popup-side [Callback](#callback-get-callbackjs) endpoint asks its connection
to navigate to the frozen [Prover](#prover-get-prover) location, supplying the
ceremony ID and captured query/fragment as that route's structured fragment.
Callback owns this transition to keep the return private from Application and
because the OAuth Platform may have severed Application's direct popup handle.

Prover captures and clears the fragment, then accepts the same logical
Application connection. It sends [`ProverReady`](#proverready) only after
cross-origin isolation is established and its CCDP handlers are installed.
Connection establishment and any internal isolation transition are below CCDP:
neither introduces another participant, message, or phase. The captured
parameters survive that transition without passing through Application.

Application accepts one `ProverReady` and sends one
[`AppStartProver`](#appstartprover) using its frozen configuration and code
verifier. It does not receive or parse the OAuth return. On receiving
`AppStartProver`, the selected platform/version validates the retained return
before credential use. A valid denial sends
[`CancelCeremony`](#cancelceremony); malformed or mismatched input sends
[`AbortCeremony`](#abortceremony). Both end the run in this phase, as does
Application cancellation. Only valid OAuth acceptance enters Phase 4.

#### 4. Prover execution

This phase begins only after [Prover](#prover-get-prover) has validated and
accepted the OAuth return in Phase 3. It performs the selected profile's token
exchange, notarization, and proof-generation steps as applicable. It sends zero or more
[`ProverNotifyEvent`](#provernotifyevent) messages followed by one
[`ProverDeliverProof`](#proverdeliverproof), unless it sends
[`AbortCeremony`](#abortceremony) or receives
[`CancelCeremony`](#cancelceremony). The first terminal outcome—proof
delivery, abort, or cancellation—ends the phase; later messages have no effect.

### Terminal outcomes

Terminal processing begins when the Application cancels an active Callback
or Prover; Prover reports valid OAuth denial; an active document reports an
abort; or Prover delivers a proof. These outcomes are mutually terminal even
when they race in transit.
Cancellation has no acknowledgement. Prover's valid denial resolves denied;
Application cancellation retains its local canceled outcome. An observable
abort rejects the live ceremony; a failure before connection acceptance is
rendered locally. CCDP
initiates no further navigation: the Application composition alone decides
whether to retain, navigate, or close the popup because any subsequent flow is
outside CCDP. Terminal cleanup follows the [invariants](#invariants).

### Successful sequence

The popup lifeline is one browsing context whose current document is replaced
at every navigation; it does not imply shared document state.

```mermaid
sequenceDiagram
    participant A as Application
    participant P as Ceremony popup

    Note over A,P: Phase 1 - Prefetch to Authorization
    A->>P: Navigate to Prefetch
    P->>P: Prefetch accepts connection
    P->>P: Prefetch registers Worker and dispatches selected-profile fetches
    break Prefetch setup fails
        P-->>A: AbortCeremony
    end
    P-->>A: PrefetchStarted
    A->>P: Navigate away to Authorization

    Note over A,P: Phase 2 - Authorization to Callback
    Note over P: User completes login and consent in Authorization
    P->>P: OAuth Platform redirects to redirectUri
    P->>P: OAuth Bridge loads Callback
    P->>P: Callback accepts authenticated connection
    break Callback fails after connection acceptance
        P-->>A: AbortCeremony
    end

    Note over A,P: Phase 3 - Callback to Prover
    P->>P: Callback navigates to Prover with private return fragment
    P->>P: Prover accepts connection with isolation established
    P-->>A: ProverReady
    break Application cancels
        A-->>P: CancelCeremony
    end
    A-->>P: AppStartProver

    P->>P: Validate retained OAuth return
    break Valid OAuth denial
        P-->>A: CancelCeremony
    end
    break Invalid OAuth return
        P-->>A: AbortCeremony
    end
    Note over A,P: Phase 4 - Prover execution after OAuth acceptance
    loop Zero or more progress events
        P-->>A: ProverNotifyEvent
    end
    break Prover fails
        P-->>A: AbortCeremony
    end
    P-->>A: ProverDeliverProof
```

Terminal exits are shown without their cleanup details, which follow
[Terminal outcomes](#terminal-outcomes) and the [message contracts](#messages).
Carrier mechanics and proof-generation internals are omitted.
