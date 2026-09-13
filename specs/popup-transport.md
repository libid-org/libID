# Popup transport

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document is the normative owner of the logical connection between an
application document and a sequence of popup documents: how endpoints are
identified and allowlisted, what a message is, what delivery guarantees the
Carried Protocol may rely on, how navigation and closure behave, what
continuity is guaranteed across popup-document replacement, and how failure
is reported. A Carried Protocol cites these rules instead of restating
browser mechanics.

It does not own the wire format of any carrier (the MessagePort handshake,
the Service Worker port keeper, WebRTC signaling), the programming interface
of an implementation, its diagnostic catalog, or any Carried Protocol.
Those belong to implementations such as `@libid/popup` and to the Carried Protocols.

## 2. Terminology

Application Document: The top-level document that creates or adopts the popup
   and holds the long-lived Application Endpoint.

Popup: The one separate top-level browsing context the Application Document
   creates during a user activation, by script or through the same
   activation's anchor. It is script-closable and remains so across
   navigation and a browsing-context-group switch.

Participating Document: A document shown in the Popup which runs a Popup
   Endpoint for the Logical Connection.

Non-participating Document: Any other document shown in the Popup, such as an
   identity-platform consent page.

Logical Connection: One bidirectional channel between the Application
   Endpoint and the current Popup Endpoint, identified by one Connection ID
   and surviving Participating Document replacement.

Connection ID: The Carried Protocol's identifier of one Logical Connection
   (§5). It correlates endpoints; it is not a capability.

Application Endpoint: The connection endpoint in the Application Document.
   It lives for the Logical Connection and may see several Participating
   Documents.

Popup Endpoint: The connection endpoint in one Participating Document. Each
   Participating Document constructs its own.

Origin Allowlist: The immutable set of origins an endpoint accepts as its
   peer: the Application Endpoint's popup origins and the Popup Endpoint's
   application origins (§6).

Carrier: The native browser channel the Logical Connection currently uses.
   The transport selects one authenticated Carrier per Participating Document;
   Carrier identity is not observable above the transport.

Fallback Carrier: An optional Carrier that does not need the opener
   relationship, supplied by deployment configuration in every document.

Carried Protocol: The protocol layered on this transport, which owns every
   value it sends over the Logical Connection and the meaning of each.

Protocol Message: A value the Carried Protocol sends over the Logical
   Connection.

Control: One of the two transport-owned messages, `navigate` and
   `close-popup`, sent only by the Application Endpoint.

Direct Control: The Application Document's ability to navigate or close the
   Popup through its retained window handle while that handle is usable.

Opener Isolation: A Participating Document whose opener policy severs the Popup's
   relationship to the Application Document on load.

Cross-origin Isolation: The browser state reported by `crossOriginIsolated`.
   It does not by itself imply Opener Isolation: a browser may isolate a
   document without severing its opener.

Continuity: Best-effort preservation of the Logical Connection across
   Participating Document replacement, by preserving the current Carrier or
   authenticating a fresh one. It guarantees neither delivery across a
   Carrier change nor recovery of lost messages.

## 3. Assumptions

- ASM-POPUP-01:
  The user agent stamps window-message events with the sender's origin and
  source window, and neither can be forged by page script. Subsequent
  MessagePort traffic inherits the authenticated channel binding; it does
  not carry a fresh browser-stamped origin or source window.
- ASM-POPUP-02:
  A browsing-context-group switch caused by an opener policy severs the
  opener relationship in the new document and makes the previously retained
  window handle report closed in the Application Document.
- ASM-POPUP-03:
  A Service Worker serves only documents of its own origin, and a
  Participating Document can reach the active worker whose scope matches its
  URL without being controlled by it.
- ASM-POPUP-04:
  Structured clone preserves plain records, arrays, strings, numbers,
  booleans, and byte arrays across documents without reinterpretation.
- ASM-POPUP-05:
  A popup created by `window.open` or by an activated anchor with a valid
  named target is a separate top-level traversable that script may close,
  whether the user agent presents it as a window or a tab.
- ASM-POPUP-06:
  A configured Fallback Carrier authenticates both endpoint origins, roles,
  and the Connection ID before returning a channel. Any authentication or
  signaling service it relies on is trusted not to substitute peers. A
  Connection ID alone is insufficient. Compromise of an admitted origin or
  that service is outside the authenticated-peer guarantee.

## 4. Security properties

The properties below hold against a hostile Non-participating Document, a
hostile document on an origin outside the allowlist holding a reference to either
window, and an unauthenticated peer that learned the Connection ID. They assume
an unmodified implementation and user agent (ASM-POPUP-01), trusted admitted
origins, and the fallback authentication boundary of ASM-POPUP-06 when used.

- SP-POPUP-01:
  Only a document on an origin in the peer's Origin Allowlist becomes an
  endpoint of the Logical Connection, and only after the transport has
  authenticated both endpoint origins. A Popup Endpoint deployed with the
  wildcard allowlist accepts any origin admitted by REQ-POPUP-ALLOW-01;
  it still binds one exact authenticated peer origin. Depends on
  ASM-POPUP-01 and, when fallback is selected, ASM-POPUP-06.
  Evidence: supporting conformance tests TEST-POPUP-02, TEST-POPUP-03,
  TEST-POPUP-08.
- SP-POPUP-02:
  One Logical Connection admits at most one current Popup Endpoint. The
  opener-based Carrier additionally binds the exact retained Popup window;
  a Fallback Carrier authenticates its peer without proving WindowProxy
  identity. An unauthenticated document cannot select, replace, or control
  either binding. Depends on ASM-POPUP-01 and ASM-POPUP-06.
  Evidence: supporting conformance tests TEST-POPUP-03, TEST-POPUP-08.
- SP-POPUP-03:
  Protocol Messages travel only over the authenticated Carrier. No cookie,
  storage, URL, request, or continuity record ever carries one.
- SP-POPUP-04:
  Only the Application Endpoint can navigate or close the Popup through the
  Logical Connection's Controls. No Protocol Message or untrusted URL or
  storage value implicitly authorizes a Control. Popup-local navigation and
  closure remain explicit actions of the Popup Endpoint.
- SP-POPUP-05:
  Loss of a Carrier, an endpoint, the Popup, or Continuity is never observed
  as delivery, success, denial, cancellation, or recovery by the protocol
  above.
- SP-POPUP-06:
  Knowledge of the Connection ID alone grants no binding, message-delivery,
  or control authority. It does not guarantee availability against hostile
  traffic or a Non-participating Document that never returns. Depends on
  ASM-POPUP-01 and ASM-POPUP-06. Evidence: supporting conformance tests
  TEST-POPUP-03, TEST-POPUP-08.

## 5. Connection identity

- REQ-POPUP-ID-01:
  A Connection ID MUST match the canonical lowercase RFC 4122 UUIDv4 grammar
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  An implementation MUST reject any other spelling before any carrier,
  continuity, or signaling work and MUST NOT normalize case or format.
- REQ-POPUP-ID-02:
  The Carried Protocol MUST generate each Connection ID with a
  cryptographically secure random source, MUST use a fresh value for every
  Logical Connection, and MUST NOT reuse a value after failure or closure.
  The transport keeps no durable registry of used values.
- REQ-POPUP-ID-03:
  Every Participating Document of one Logical Connection MUST receive the
  same exact Connection ID. How it reaches the document is owned by the
  Carried Protocol.
- REQ-POPUP-ID-04:
  An implementation MUST use the Connection ID only for correlation and
  authentication of its own controls. It MUST NOT treat possession of the
  ID as authority and MUST NOT expose it to the Carried Protocol through
  transported values.

## 6. Origin allowlists and binding

- REQ-POPUP-ALLOW-01:
  Each endpoint MUST be constructed with a nonempty Origin Allowlist of
  canonical HTTPS origins without duplicates, with HTTP also admitted on
  exactly `localhost` and `127.0.0.1`. Any valid port is permitted; matching
  uses the exact canonical origin, including its scheme and effective port.
  The implementation MUST reject an empty set, opaque origin, malformed,
  noncanonical, credentialed, or repeated member, or any other HTTP host,
  before carrier work. It MUST NOT resolve a hostname to decide whether it
  qualifies for the HTTP exception. A Popup Endpoint MAY instead use `'*'`,
  admitting every origin satisfying the same URL rules while still
  authenticating its peer. An Application Endpoint MUST NOT accept a
  wildcard. Upholds SP-POPUP-01.
- REQ-POPUP-ALLOW-02:
  An endpoint MUST accept a peer only when the peer's authenticated origin
  is a member of its Origin Allowlist, and MUST bind that exact observed origin
  for the life of the resulting Carrier. Sequential Participating Documents
  MAY bind different members. The Endpoint MUST expose the selected Carrier's
  authenticated peer origin to the Carried Protocol. The Endpoint MUST expose no
  authenticated peer origin when it has no selected Carrier. The
  Endpoint MUST check the bound origin against its own Origin Allowlist before
  accepting a preserved, replacement, or Fallback Carrier. Upholds SP-POPUP-01.
- REQ-POPUP-ALLOW-03:
  On the opener path, the Application Endpoint MUST accept peer traffic only
  from the window it created or, on the native-anchor path, from the one
  window whose first exact authentication it accepted. The Popup Endpoint MUST accept peer
  traffic only from its opener on that path. A Fallback Carrier MUST
  authenticate both peers independently of the opener under ASM-POPUP-06;
  neither endpoint MAY replace that authentication with possession of the
  Connection ID. Upholds SP-POPUP-01, SP-POPUP-02, SP-POPUP-06.
- REQ-POPUP-ALLOW-04:
  A Carrier MUST become selectable only after both endpoints have
  authenticated each other. A mismatch of origin, source, Connection ID,
  transport version, or direction MUST select nothing and release no value.
  On the opener path, an endpoint MUST ignore an attempt from an unexpected
  source without state change. The Application Endpoint MUST also ignore
  attempts from unlisted popup origins. The Popup Endpoint MUST reject an
  authentication response from its exact opener with an unapproved origin;
  either endpoint MUST reject malformed authentication from its expected
  peer. An opener-independent Carrier MUST enforce
  equivalent peer, origin, role, and connection binding through its own
  authentication mechanism, not require a window-message event.
  Upholds SP-POPUP-01, SP-POPUP-02.
- REQ-POPUP-ALLOW-05:
  On the opener path, an event that does not carry the transport's own
  authentication discriminator together with this Connection ID is not an
  authentication attempt and MUST be ignored. In particular, a valid attempt for another
  Connection ID and any message a Non-participating Document sends to the
  Application Document MUST NOT affect the Logical Connection.
  Upholds SP-POPUP-06.
- REQ-POPUP-ALLOW-06:
  When scripted creation returns no handle, the Application Endpoint MUST
  bind the Popup created by the same activation's anchor only through the
  exact initial authentication of §6, and MUST perform no browser operation
  on the Popup until that binding completes. The anchor MUST carry a valid,
  unique named target and MUST NOT request `noopener` or `noreferrer`.

## 7. Message model

- REQ-POPUP-MSG-01:
  A Protocol Message is a plain record with a string `type` of 1 to 64 UTF-16
  code units. The transport reads only `type` for routing and never
  interprets any other field.
- REQ-POPUP-MSG-02:
  The discriminators `navigate` and `close-popup` are reserved for Controls.
  The Carried Protocol MUST NOT send or register either; an implementation MUST
  reject the attempt synchronously.
- REQ-POPUP-MSG-03:
  The Carried Protocol registers, per discriminator, exactly one decoder and
  handler. For each inbound value the transport MUST select the registered
  decoder by `type`, call it exactly once, and deliver the decoded message
  to its handler. Duplicate registration MUST be rejected.
- REQ-POPUP-MSG-04:
  An inbound value that is not a plain record, whose `type` is not a
  registered discriminator, or whose decoder throws MUST fail the Logical
  Connection and reach no handler. An exception thrown by the handler itself
  belongs to the Carried Protocol: it MUST propagate untouched and MUST NOT
  change connection state or reach diagnostics. The registered set therefore
  fixes the accepted direction of each message; ordering and protocol state
  remain the handler's responsibility.
- REQ-POPUP-MSG-05:
  Both endpoint constructors return synchronously and select a Carrier
  afterwards. The Carried Protocol MUST register its handlers before yielding
  to the event loop after obtaining its endpoint. The transport delivers inbound values
  as later tasks and MUST NOT queue a value for a handler registered later.
- REQ-POPUP-MSG-06:
  Sending without a selected Carrier, or after closure, MUST fail
  synchronously. The transport MUST NOT queue Protocol Messages outside a
  Carrier.
- REQ-POPUP-MSG-07:
  Values are transported by structured clone. The transport MUST NOT add
  encoding, normalization, or copies for its built-in Carrier, and MUST
  deliver the received object itself to the decoder. A Fallback Carrier MAY
  publish a value-domain and size bound, which the Carried Protocol MUST
  respect.

## 8. Delivery guarantees

- REQ-POPUP-DELIVER-01:
  Over one selected Carrier, Protocol Messages are delivered in send order and
  at most once.
- REQ-POPUP-DELIVER-02:
  No Protocol Message is delivered before both endpoints have authenticated
  (REQ-POPUP-ALLOW-04), and every Protocol Message stays behind that
  authentication on the ordered channel.
- REQ-POPUP-DELIVER-03:
  Sending is not an acknowledgement. The transport provides no delivery
  receipt for Protocol Messages or Controls.
- REQ-POPUP-DELIVER-04:
  Background suspension of either document MAY delay delivery. It is not
  success, cancellation, or a reason to select another Carrier; delivery
  after resumption preserves order.
- REQ-POPUP-DELIVER-05:
  Carrier loss MAY be silent. A Protocol Message sent into a lost Carrier
  succeeds locally and is lost. The Carried Protocol MUST derive outcomes only
  from messages it receives.
- REQ-POPUP-DELIVER-06:
  Protocol Messages sent over a Carrier before a Control are delivered to the
  Popup Endpoint's handlers before the Popup acts on that Control, whatever
  the destination. A transition that must carry the Application Endpoint's
  reply is therefore driven by the Application Endpoint, which replies and
  then navigates, or the Popup navigates only after receiving the reply. The
  transport buffers nothing and retransmits nothing; navigation away by the
  Application Endpoint does not wait for the Carrier and MUST NOT be used to
  deliver a reply. After the Application Endpoint sends a navigation Control,
  Protocol Messages it sends cannot reach the departing document: across a
  replacement preserving the same Carrier they wait in that Carrier and reach
  destination once it accepts, provided it registered their handlers before
  yielding; when the Carrier is retired instead, including for a same-origin
  non-preservable Carrier, they are lost until a fresh Carrier authenticates.

## 9. Lifecycle, navigation, and control

- REQ-POPUP-LIFE-01:
  A Logical Connection has one Application Endpoint and, for each
  Participating Document, a fresh Popup Endpoint. The Popup Endpoint selects
  exactly one Carrier for its document; the Application Endpoint installs
  the Carrier the Popup Endpoint authenticated, replacing any earlier one.
- REQ-POPUP-LIFE-02:
  The Popup Endpoint MUST prefer a preserved Carrier (§10), then the opener
  path, then the Fallback Carrier. An absent or closed opener, or an opener
  that does not answer within the implementation's published deadline,
  commits the fallback. An authentication failure is terminal and MUST NOT
  select a weaker path. Without a Fallback Carrier, an unreachable opener
  fails the Logical Connection. A same-origin continuity owner that does not
  answer is treated as holding nothing.
- REQ-POPUP-CONTROL-01:
  Controls travel from the Application Endpoint to the Popup Endpoint only.
  A Control received by the Application Endpoint MUST fail the Logical
  Connection. Controls carry only the selected navigation URL, including
  caller-supplied fragment data, or the closure instruction; they do not
  encapsulate Protocol Messages. Popup-local navigation sends no Control.
- REQ-POPUP-CONTROL-02:
  The first accepted Control is terminal for the receiving Participating
  Document. A later, duplicate, replayed, unknown, or malformed Control MUST
  perform no browser operation.
- REQ-POPUP-CONTROL-03:
  A navigation destination MUST be the serialization of an absolute URL
  without credentials whose scheme and host satisfy REQ-POPUP-ALLOW-01.
  Both the sender and the receiver MUST reject any other value before any
  browser operation. A destination need not be an allowlisted participant.
  The transport does not interpret the destination.
- REQ-POPUP-CONTROL-04:
  Application-side navigation: with a selected Carrier the Application
  Endpoint MUST send `navigate` over it; without one it MUST use Direct
  Control only while its retained handle is non-null and does not report
  closed; while native-anchor binding is pending it MUST perform no browser
  operation; otherwise it MUST reject.
- REQ-POPUP-CONTROL-04A:
  Navigation away, for a Non-participating destination: the Application
  Endpoint MUST navigate its retained handle through Direct Control without
  sending the destination over any Carrier, MUST retire the current Carrier
  without attempting Continuity, and MUST remain ready to authenticate the
  next Participating Document. It MUST reject once the handle is absent or
  reports closed, and MUST perform no browser operation while native-anchor
  binding is pending. A Popup Endpoint navigating away MUST release its
  Carrier and replace its document without attempting Continuity. The
  destination of navigation away is private to the endpoint that performs
  it: no Control carries it, so it never reaches a Carrier or its signaling,
  and a Popup under Opener Isolation MUST initiate its own departure.
  REQ-POPUP-LIFE-03 applies until the next Participating Document
  authenticates.
- REQ-POPUP-CONTROL-05:
  Popup-side navigation acts locally and sends no Control. Either path on
  the popup side MUST prepare Continuity where §10 applies, then replace the
  current document without adding a history entry and without creating a
  browsing context.
- REQ-POPUP-CONTROL-06:
  Closure from the Application Endpoint MUST close the Popup through Direct
  Control while the handle is usable and otherwise send `close-popup` over
  a selected Carrier, then release the Logical Connection. A Popup Endpoint
  receiving `close-popup`, or closing itself, MUST release the connection
  and close its own window. Closure is idempotent.
- REQ-POPUP-CONTROL-07:
  The Carried Protocol MUST invoke closure only for a Popup created as in
  ASM-POPUP-05. A same-tab or full-page presentation MUST NOT be closed
  through the transport; there is no reliable runtime probe for
  closability after Opener Isolation.
- REQ-POPUP-LIFE-03:
  A connected navigation to a Non-participating Document leaves the
  Application Endpoint without a usable Carrier until the next Participating
  Document authenticates, and the Application Endpoint cannot observe that
  window. Protocol Messages and Controls sent meanwhile succeed locally and
  are lost; closure still uses Direct Control while the handle is usable.
  After navigation away the Carrier is retired instead, and sending fails
  synchronously.
- REQ-POPUP-LIFE-04:
  Any navigation of the Popup outside the transport's own operation loses
  the current Carrier. A later Participating Document MAY establish a fresh
  Carrier under the same Logical Connection; nothing is recovered.
- REQ-POPUP-LIFE-05:
  A Participating Document under Opener Isolation has no opener. It MUST
  obtain a preserved Carrier (§10) or authenticate a Fallback Carrier. A
  cross-origin destination under Opener Isolation therefore requires a
  Fallback Carrier; without one the Logical Connection fails closed.
- REQ-POPUP-LIFE-06:
  Closing the Logical Connection MUST abort every pending authentication,
  continuity, and fallback operation of that connection.

## 10. Continuity

- REQ-POPUP-CONT-01:
  Preservation of the same Carrier applies only to a transport-initiated
  replacement of one Participating Document by another on the same origin.
  Same origin alone does not make a Carrier preservable. The implementation
  MUST publish the bound within which the destination must begin accepting,
  and the destination MUST construct its Popup Endpoint before any other
  network work.
- REQ-POPUP-CONT-02:
  A preserved Carrier is the same authenticated channel: the Application
  Endpoint observes no replacement, no re-authentication occurs, and every
  Protocol Message already sent stays in order ahead of later ones.
- REQ-POPUP-CONT-03:
  When the same-origin destination does not resolve the same active
  continuity owner as the source, or the bound expires, the destination
  finds nothing and proceeds as a fresh Participating Document under
  REQ-POPUP-LIFE-02.
- REQ-POPUP-CONT-04:
  A cross-origin replacement, including a cross-site one, MUST NOT attempt
  to preserve the same Carrier. The source Popup Endpoint retires and the
  destination authenticates a fresh Carrier. The Connection ID and the registrations of
  the Carried Protocol are unchanged; REQ-POPUP-LIFE-03 applies until the
  destination authenticates.
- REQ-POPUP-CONT-05:
  If a navigation requires preserving a Carrier or preparing its successor,
  the transport MUST reject before navigating when that preparation fails.
  It MUST NOT navigate with unprepared live state.
- REQ-POPUP-CONT-05A:
  For a selected Carrier that cannot survive document replacement but
  supports preparing a successor, the transport MUST prepare fresh
  authentication before retiring that Carrier and navigating. The
  destination MUST authenticate its own Carrier under the same Logical
  Connection before delivery. Preparation failure MUST reject before
  navigation. From retirement until destination authentication, values sent
  by the Application Endpoint may succeed locally and be lost; the
  transport MUST NOT queue or replay them. This applies on the same origin
  as well as across origins. Necessity: logical-connection continuity does
  not imply channel preservation or delivery across a replacement.
- REQ-POPUP-CONT-06:
  The transport MUST NOT copy Protocol Messages into continuity or
  authentication records or retain such records beyond their bounds. Values
  already queued in a preserved native Carrier remain in that Carrier.
  The transport cannot tell a Participating destination
  from a Non-participating one before it loads: a same-origin document that
  arrives within the bound MAY find the preserved Carrier whatever showed in
  between. A Carried Protocol that requires retirement uses navigation away.
- REQ-POPUP-CONT-07:
  A Popup Endpoint MAY require cross-origin isolation of its document by
  naming a same-origin isolated replacement. An already isolated document
  MUST proceed without that replacement. Before delivering anything or
  becoming ready, an endpoint whose document is not isolated MUST take the
  applicable path:

  - With a preserved or opener-established Carrier, preserve it through
    Continuity and replace the document; the destination restores it.
  - With neither of those available and a configured Fallback Carrier,
    replace the document before constructing the fallback. The isolated
    destination alone establishes it using the still-unused authentication
    attempt, including one prepared under REQ-POPUP-CONT-05A. No connection
    is established merely to discard it in this intermediate document.
  - With no usable path, fail closed without navigating.

  The departing endpoint MUST NOT deliver anything or become ready.
  It MUST settle closed on departure. The replacement MUST enforce isolation and
  fail rather than navigate again if it is still not isolated. The Carried
  Protocol observes one Logical Connection and one ready destination, not
  necessarily the same Carrier. Values remain ordered in a preserved
  Carrier; a retired Carrier has the loss window of REQ-POPUP-CONT-05A.
  Sending before any Carrier has ever been selected fails under
  REQ-POPUP-MSG-06. Necessity: require isolation without an extra connection
  or premature delivery in the non-isolated intermediate document.
- REQ-POPUP-CONT-08:
  The transport MUST treat caller-supplied navigation fragment data as
  opaque and preserve its supplied serialization in the destination,
  including through the isolation replacement of REQ-POPUP-CONT-07. It
  MUST NOT disclose a Popup Endpoint's locally selected destination or
  fragment to the Application Endpoint, signaling, diagnostics, or durable
  continuity storage. Application-initiated navigation intentionally sends
  its destination to the Popup in a Control. The Carried Protocol owns
  destination selection, fragment contents, and their disclosure policy,
  including for cross-origin navigation. Necessity: protocols can pass
  private navigation inputs without giving the transport their semantics.

## 11. Failure semantics

- REQ-POPUP-FAIL-01:
  An observed failure MUST release the endpoint's reachable resources and
  release no later value. It MUST NOT synthesize a Control, close the Popup,
  or select a weaker Carrier.
- REQ-POPUP-FAIL-02:
  An operation the Carried Protocol invoked reports failure through that
  operation, carrying its stable code. Every endpoint exposes its terminal
  outcome, settled exactly once as closed or failed with the stable code;
  a failure with no invoking operation reaches the Carried Protocol only
  there, and the implementation's local diagnostics additionally record it.
- REQ-POPUP-FAIL-03:
  Diagnostics MUST NOT contain an origin, URL, Connection ID, message
  discriminator, transported value, or raw exception, and MUST NOT leave
  the device through the transport.

## 12. Conformance

Roles: Application Endpoint, Popup Endpoint. An implementation claiming the
transport MUST pass the applicable vectors below for both roles. Fallback
assertions apply when that optional Carrier is provided; an injected test
stand-in does not qualify its authentication or browser behavior. The reference
implementation's test plan indexes them as the POPUP-API, POPUP-WINDOW,
POPUP-CONTROL, and POPUP-CONNECTION rows; carrier-internal rows are outside
this specification.

- TEST-POPUP-01 (exercises REQ-POPUP-ID-01):
  Uppercase, noncanonical, wrong-version, wrong-variant, and malformed
  Connection IDs are rejected before any carrier work.
- TEST-POPUP-02 (exercises REQ-POPUP-ALLOW-01, REQ-POPUP-ALLOW-02):
  An empty set or a duplicate, noncanonical, credentialed, or disallowed-HTTP
  member is rejected; a peer on an origin outside the allowlist never becomes
  an endpoint; sequential Participating Documents on two allowlisted origins bind
  under one Logical Connection. Each Endpoint exposes the exact authenticated
  origin, not the allowlist; before selection and after local retirement it exposes
  none. Under the wildcard, a Popup Endpoint binds
  any permitted origin exactly, rejects an opaque or disallowed-HTTP one, and an
  Application Endpoint rejects the wildcard. A handshake from another window
  or an unlisted popup origin leaves the Application Endpoint untouched. HTTP on exact
  `localhost` and `127.0.0.1` works with explicit allowlists and the wildcard
  at arbitrary valid ports; different ports do not match. HTTP lookalikes,
  other loopback spellings, private-network hosts, credentials, and
  noncanonical default-port spellings fail.
- TEST-POPUP-03 (exercises REQ-POPUP-ALLOW-03, REQ-POPUP-ALLOW-04, REQ-POPUP-ALLOW-05):
  Wrong source, origin, version, or direction selects nothing; a valid
  attempt for another Connection ID and unrelated traffic from the Popup
  are ignored; two concurrent Logical Connections on one page never reject
  each other. An authentication response from the exact opener with an
  unapproved origin fails the Popup Endpoint without selecting fallback.
- TEST-POPUP-04 (exercises REQ-POPUP-ALLOW-06):
  With scripted creation blocked, the activation's anchor creates the Popup
  and only the exact initial authentication binds it; `noopener` and an
  origin outside the allowlist never bind.
- TEST-POPUP-05 (exercises REQ-POPUP-MSG-01 to REQ-POPUP-MSG-07):
  Reserved discriminators and duplicate registrations are rejected; the
  decoder runs exactly once and its object is delivered; unknown, malformed,
  and decoder-rejected input fails the connection and reaches no handler;
  sending without a Carrier fails synchronously and queues nothing.
- TEST-POPUP-06 (exercises REQ-POPUP-DELIVER-01 to REQ-POPUP-DELIVER-06):
  Values arrive in order and once; nothing arrives before mutual
  authentication; a closed peer delivers nothing and produces no outcome; a
  reply sent before a navigation Control reaches the Popup's handler before
  the Popup leaves for a cross-origin destination.
- TEST-POPUP-07 (exercises REQ-POPUP-CONTROL-01 to REQ-POPUP-CONTROL-06, REQ-POPUP-LIFE-06):
  Controls are application-to-popup and one-shot; malformed destinations
  fail before any browser operation; navigation uses the Carrier when
  selected and Direct Control otherwise; navigation away sends nothing over
  the Carrier, keeps nothing, rejects without Direct Control, and the next
  Participating Document authenticates afresh; closure works directly with a
  usable handle and over the Carrier after Opener Isolation, and is idempotent.
- TEST-POPUP-08 (exercises REQ-POPUP-LIFE-02, REQ-POPUP-LIFE-05):
  A document without opener and without a Fallback Carrier fails closed
  exactly once; an authentication failure never commits the fallback; a
  Fallback Carrier is used only after the opener path is unavailable and
  authenticates both peer origins and roles without requiring an opener.
  Knowledge of the Connection ID without that authentication selects nothing
  (REQ-POPUP-ALLOW-03, REQ-POPUP-ALLOW-04).
- TEST-POPUP-09 (exercises REQ-POPUP-CONT-01 to REQ-POPUP-CONT-03, REQ-POPUP-LIFE-03):
  In each supported engine, a same-origin replacement into and out of
  Opener Isolation preserves a transferable Carrier within the published bound; a
  Non-participating Document beyond the bound loses it and the next
  Participating Document re-authenticates. The restored Endpoint exposes the
  preserved peer origin; a destination allowlist excluding that origin rejects
  before delivery and does not substitute fresh authentication for the mismatch.
- TEST-POPUP-10 (exercises REQ-POPUP-CONT-04, REQ-POPUP-CONT-05, REQ-POPUP-LIFE-05):
  A cross-site replacement re-authenticates over the opener without
  attempting Carrier preservation; a cross-site destination under Opener
  Isolation without a Fallback Carrier fails closed; a replacement whose Continuity cannot be
  prepared rejects before navigating.
- TEST-POPUP-11 (exercises REQ-POPUP-CONT-07):
  An isolation-requiring document that the engine isolates directly
  installs without navigating; one it does not isolate preserves its
  Carrier before readiness or delivery and reaches isolation through the
  named replacement, which delivers every value sent meanwhile exactly
  once; a replacement that stays non-isolated fails without looping. With no
  preserved/opener Carrier and a configured fallback, the intermediate
  document navigates without constructing a fallback or becoming ready;
  only the isolated destination authenticates. This works both for an
  initial connection and a prepared successor. Sending before first
  selection fails; sending into a retired predecessor is lost, never
  recovered by the successor. No configured fallback means no navigation.
- TEST-POPUP-12 (exercises REQ-POPUP-CONT-05A, REQ-POPUP-DELIVER-06):
  A non-preservable Carrier prepares its successor before same-origin or
  cross-origin navigation, but that successor becomes selectable only after
  destination authentication. An earlier reply reaches the departing
  document; values sent after retirement are lost and never replayed. After
  authentication, new values deliver in order. Failed preparation performs
  no navigation; failed destination authentication releases no value.
- TEST-POPUP-13 (exercises REQ-POPUP-CONT-08):
  Caller fragments retain their supplied spelling, order, duplicates, and
  escapes through navigation and isolation replacement, even if the source
  cleared its URL after capturing them. Popup-local destinations and
  fragments reach no Application Endpoint, signaling, or diagnostics;
  application-selected fragments travel only in the intended Control and
  destination URL, not in durable continuity records.

## 13. Security Considerations

- The Connection ID appears in the Popup's URL under most Carried Protocols
  and may reach Non-participating Documents. It grants no authority under
  SP-POPUP-06. On the opener path, unrelated messages are ignored under
  REQ-POPUP-ALLOW-05; fallback must independently authenticate its peers.
- Origin Allowlists are deployment configuration. Listing an origin that
  serves attacker-controlled documents accepts that attacker as a peer; the
  transport cannot distinguish them. A wildcard Popup Endpoint accepts every
  permitted origin under REQ-POPUP-ALLOW-01, so it must carry a
  Carried Protocol that grants nothing to an unknown application, and the
  Application Endpoint's exact allowlist remains the only origin check on
  that side. Loopback HTTP admits local development without weakening exact
  origin or port matching; it grants no exception for arbitrary HTTP hosts.
- A Fallback Carrier's authentication is an additional deployment trust
  boundary (ASM-POPUP-06). It does not establish a browser-stamped opener
  relationship. Origin admission does not authenticate individual scripts
  served by that origin or defend against a compromised signaling service.
- Direct Control depends on the retained handle reporting closed after a
  browsing-context-group switch (ASM-POPUP-02). An engine that violated this
  would navigate a discarded context, a silent no-op, never a wrong window.
- Continuity hands an authenticated channel to a same-origin worker for a
  bounded time. Any same-origin document that knows the Connection ID could
  claim it within that bound; same-origin documents are already inside the
  trust boundary of the Participating Document.
- Isolation through a replacement depends on the host serving that
  replacement with effective isolation policy. A preserved port additionally
  depends on a reachable same-origin continuity worker; an opener-independent
  fallback depends on fresh authentication at the isolated destination.
  Neither path permits unisolated delivery. Carrier retirement can lose
  values even when the replacement is same-origin; a Carried Protocol waits
  for its destination's own readiness message before sending work to it.
- Nothing in this transport authenticates the user, the Carried Protocol, or
  the outcome of anything the Popup did; it authenticates only which
  documents are talking.

## 14. Provenance

Each requirement traces to the implementation documents it was extracted
from; those documents keep the mechanics.

| Requirement | Source |
|---|---|
| REQ-POPUP-ID-01 to ID-04 | connection.md, Connection ID |
| REQ-POPUP-ALLOW-01, ALLOW-02 | connection.md, API (`allowedPopupOrigins`, `allowedApplicationOrigins`) |
| REQ-POPUP-ALLOW-03 to ALLOW-05 | message-port.md, Failure and security invariants; Authentication |
| REQ-POPUP-ALLOW-06 | connection.md, Popup creation and native-anchor fallback |
| REQ-POPUP-MSG-01 to MSG-07 | connection.md, `send` and `on` rules; message-port.md, Message delivery |
| REQ-POPUP-DELIVER-01 to DELIVER-06 | connection.md, Failure and security rules; message-port.md, invariants |
| REQ-POPUP-LIFE-01, LIFE-02 | connection.md, Selection |
| REQ-POPUP-CONTROL-01 to CONTROL-07 | control.md, Records; Execution; Security boundary |
| REQ-POPUP-LIFE-03 to LIFE-06 | connection.md, navigate rules; Continuity across navigations |
| REQ-POPUP-CONT-01 to CONT-08 | connection.md, Continuity across navigations and isolation fallback; message-port.md, Continuity across navigations |
| REQ-POPUP-FAIL-01 to FAIL-03 | connection.md, Failure and security rules; METRICS.md, Privacy and failure handling |

## 15. References

Normative:

- [HTML] WHATWG HTML Standard. Cross-document messaging
  (<https://html.spec.whatwg.org/multipage/web-messaging.html#crossDocumentMessages>),
  message channels
  (<https://html.spec.whatwg.org/multipage/web-messaging.html#message-channels>),
  safe passing of structured data
  (<https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data>),
  browsing-context-group switches due to Cross-Origin-Opener-Policy
  (<https://html.spec.whatwg.org/multipage/browsers.html#coop-bcg-switch>),
  and valid navigable target names
  (<https://html.spec.whatwg.org/multipage/document-sequences.html#valid-navigable-target-name-or-keyword>).
- [SW] W3C Service Workers. Registration scope matching
  (<https://w3c.github.io/ServiceWorker/#scope-match-algorithm>).
- [RFC4122] A Universally Unique IDentifier (UUID) URN Namespace
  (<https://www.rfc-editor.org/rfc/rfc4122>).
- [RFC2119] Key words for use in RFCs to Indicate Requirement Levels
  (<https://www.rfc-editor.org/rfc/rfc2119>), as clarified by [RFC8174]
  (<https://www.rfc-editor.org/rfc/rfc8174>).
