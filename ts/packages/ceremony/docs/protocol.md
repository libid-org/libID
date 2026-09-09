# Ceremony Cross-Document Protocol (CCDP)

This document defines the closed browser protocol across the Application and
the [documents](documents.md#documents-and-routes) it uses. It owns ceremony locations,
navigations, messages, ordering, and compatibility. Authorization,
platform-proof, and final-proof semantics are defined by the normative
[common ceremony](../../../../specs/ceremony-common.md) and
[platform ceremony](../../../../specs/platform-ceremonies.md) specifications.

An authenticated, ordered, bidirectional popup connection carries CCDP
messages unchanged. CCDP requires that connection but does not prescribe its
implementation. [CCDP_DISTRIBUTION.md](distribution.md) defines the static
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
| OAuth Bridge | OAuth bridge origin | publishes ceremony configuration, serves the complete Callback document obtained from the Distribution with bridge-owned inputs, owns OAuth registrations, and performs enabled confidential OAuth exchanges |
| CCDP Distribution | CCDP origin | contains the versioned [resources](documents.md#documents-and-routes) and proving assets used by any number of OAuth Bridges; it may be the canonical libID distribution or an operator-selected replacement |
| OAuth Platform | OAuth-platform origin set | hosts authorization/login documents and issues the OAuth return |

The Application and OAuth Bridge may be operated together or independently;
the selected CCDP Distribution may be published by either party or another
one. Their origins may be same-origin, same-site, or cross-site. CCDP assumes
none of those relationships. Browser authority is always established against
an exact origin. A composition which continues the live popup connection after
CCDP has the additional requirements below.

The OAuth redirect URI terminates on the bridge origin. The OAuth Bridge serves
CCDP's self-contained Callback artifact with its deployment inputs already
inserted; artifact retrieval happens server-side, independently of OAuth
requests. Callback captures and clears the OAuth return, then selects its
bundled CCDP implementation without another browser request.

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

See [CCDP documents and navigation](documents.md).

## Messages

The following table is the complete CCDP version-1 message set.

| Message | Direction | Accepted after | Cardinality and effect |
|---|---|---|---|
| [`PrefetchStarted`](#prefetchstarted) | Prefetch → Application | connection acceptance and selected-profile dispatch | exactly once; permits navigation to Authorization |
| [`ProverReady`](#proverready) | Prover → Application | Prover connection acceptance and cross-origin isolation | exactly once; permits `AppStartProver` |
| [`AppStartProver`](#appstartprover) | Application → Prover | `ProverReady` | exactly once; selects the profile for OAuth validation and proof execution |
| [`ProverNotifyEvent`](#provernotifyevent) | Prover → Application | `AppStartProver` and valid OAuth acceptance | zero or more; advisory only |
| [`ProverIdentityProof`](#proveridentityproof) | Prover → Application | `AppStartProver` and valid OAuth acceptance | at most once; ends the Prover run |
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
  ledgerId: string
}
```

`platformId` and `platformCeremonyVersion` are the exact supported profile
selected at launch and must match the active Prover. The message is valid only
after `ProverReady`. The remaining fields are the frozen client identifier and
redirect, derived code verifier, and canonical encoded ledger identifier. The
OAuth return is already retained by Prover and is not repeated in the message.
Starting Prover initiates OAuth validation; it does not assert acceptance or
mean that proof generation has
already begun.

`ledgerId` is the frozen encoding of the target ledger, using the shared
[ledger identity contract](../../ledger/README.md). Prover decodes and validates
it before credential use. Its code-owned classification selects the notary
address; no separate testnet flag, hash, or caller-selected notary URL is
accepted. Google makes no notary request. This routing choice changes no proof
statement or ledger trust rule.

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

### ProverIdentityProof

```ts
interface ProverIdentityProof {
  type: 'prover-identity-proof'
  identity: {
    platformId: string
    oauthClientId: string
    userId: string
    userName: string
  }
  proof: unknown
}
```

`identity` is a separate, exact-shaped record of prover-extracted strings:
platform identifier, OAuth client identifier, user identifier, and user name
(the signed email for Google). The selected platform validator checks their
encodings and the platform/client binding to `AppStartProver`.
`proof` is the exact value defined by that platform ceremony version, without
a nested identity copy. CCDP treats the proof as opaque; adding a platform does
not change this message. Neither browser endpoint cryptographically verifies
the delivered result; identity is non-authoritative until ledger verification.

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
  code: FailureCode
  reason: string
}
```

`AbortCeremony` reports a technical failure after connection acceptance.
`code` is a package-owned `FailureCode`; `reason` must exactly match its safe
message in [the failure catalog](../src/errors.ts). Unknown codes, mismatched
messages and extra fields reject. Client rejects with `CeremonyError`, preserving
that code and message. No original exception, stack or cause crosses CCDP.
Undeliverable failures emit one local sanitized subsystem/code diagnostic.

This extends the upstream PR #13 reason-only message by explicit implementation
request. Client and CCDP artifacts must be updated together; old reason-only
messages are not supported by this build.

## Protocol

The protocol advances one named ceremony popup through
[Prefetch](documents.md#prefetch-get-prefetch),
[Authorization](documents.md#authorization-get-platformauthorizationurl),
[Callback](documents.md#callback-get-redirecturi), and
[Prover](documents.md#prover-get-prover). Those route sections own each participant's
inputs, context, and role; [Messages](protocol.md#messages) owns the records crossing the
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
one named popup's first navigation to [Prefetch](documents.md#prefetch-get-prefetch) and
establishes its connection there. A scripted opener may first reserve the
popup at `about:blank`; if that fails, the same activation's real anchor
navigates it directly to Prefetch.

Prefetch clears and validates its fragment, accepts the connection, registers
the Worker, and dispatches the selected profile's fetches. It then sends
[`PrefetchStarted`](protocol.md#prefetchstarted). Only after accepting that message, the
Application endpoint navigates the retained popup to
[Authorization](documents.md#authorization-get-platformauthorizationurl) at the frozen
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

This phase begins when [Authorization](documents.md#authorization-get-platformauthorizationurl)
loads. The OAuth Platform owns the popup and initiates browser navigation to
the frozen `redirectUri` after approval or denial; neither CCDP endpoint
initiates that transition. The Bridge serves the complete
[Callback](documents.md#callback-get-redirecturi), which captures and clears the return and
enters its bundled CCDP implementation selected by `state`. The
[OAuth Bridge contract](oauth-bridge.md#callback-document) exclusively defines
ingress.

Callback accepts the Application connection using the ceremony ID extracted
from the captured `state`. This authenticates the Application against the
Bridge's deployment allowlist before the return can leave Callback. It sends
no OAuth-return message. Connection acceptance permits the Prover transition.

#### 3. Callback to Prover

The popup-side [Callback](documents.md#callback-get-redirecturi) endpoint asks its connection
to navigate to the frozen [Prover](documents.md#prover-get-prover) location, supplying the
ceremony ID and captured query/fragment as that route's structured fragment.
Callback owns this transition to keep the return private from Application and
because the OAuth Platform may have severed Application's direct popup handle.

Prover captures and clears the fragment, then accepts the same logical
Application connection. It sends [`ProverReady`](protocol.md#proverready) only after
cross-origin isolation is established and its CCDP handlers are installed.
Connection establishment and any internal isolation transition are below CCDP:
neither introduces another participant, message, or phase. The captured
parameters survive that transition without passing through Application.

Application accepts one `ProverReady` and sends one
[`AppStartProver`](protocol.md#appstartprover) using its frozen configuration and code
verifier. It does not receive or parse the OAuth return. On receiving
`AppStartProver`, the selected platform/version validates the retained return
before credential use. A valid denial sends
[`CancelCeremony`](protocol.md#cancelceremony); malformed or mismatched input sends
[`AbortCeremony`](protocol.md#abortceremony). Both end the run in this phase, as does
Application cancellation. Only valid OAuth acceptance enters Phase 4.

#### 4. Prover execution

This phase begins only after [Prover](documents.md#prover-get-prover) has validated and
accepted the OAuth return in Phase 3. It performs the selected profile's token
exchange, notarization, and proof-generation steps as applicable. It sends zero or more
[`ProverNotifyEvent`](#provernotifyevent) messages followed by one
[`ProverIdentityProof`](#proveridentityproof), unless it sends
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
outside CCDP. Terminal cleanup follows the [invariants](protocol.md#invariants).

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
    P->>P: Callback starts and selects its bundled version
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
    P-->>A: ProverIdentityProof
```

Terminal exits are shown without their cleanup details, which follow
[Terminal outcomes](protocol.md#terminal-outcomes) and the [message contracts](protocol.md#messages).
Carrier mechanics and proof-generation internals are omitted.

## Implementation guide

Pure message types, decoder companions and navigation encodings shared by the Client
and document entrypoints. The public `@libid/ceremony/ccdp` export stays browser-free.

- [Documents](documents.md#implementation-guide): Callback, Prefetch and Prover entrypoints.
- [Routes and fragments](documents.md): versioned locations and private handoff.

[index.ts](../src/ccdp/index.ts) defines the seven message companions. [navigation.ts](../src/ccdp/navigation.ts)
owns fragment codecs and state routing. `@libid/popup` supplies authenticated delivery,
window lifecycle and continuity; CCDP owns no carrier implementation.
