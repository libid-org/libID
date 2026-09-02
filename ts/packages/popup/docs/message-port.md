# MessagePort carrier

This document defines the preferred browser-local carrier used by the
[popup connection](connection.md) while the returned popup retains its
application opener.

`MessagePort` is the simplest carrier for this job. One `window.postMessage`
exchange authenticates browser-stamped source and origin and transfers one end
of a `MessageChannel`; the entangled ports then provide ordered structured-clone
delivery without framing, signaling, or a server. These are standard browser
primitives defined by the HTML Standard's [cross-document messaging](https://html.spec.whatwg.org/multipage/web-messaging.html#crossDocumentMessages)
and [message-channel](https://html.spec.whatwg.org/multipage/web-messaging.html#message-channels)
sections.

Its limitation is establishment under isolation. `window.postMessage` requires
a live `WindowProxy`, while Cross-Origin-Opener-Policy can cause a
[browsing-context-group switch](https://html.spec.whatwg.org/multipage/browsers.html#coop-bcg-switch)
which severs the opener relationship. If that happens before a returned popup
document binds its channel, this carrier is unavailable for that document. Each
participating popup document either claims a preserved port or establishes a
fresh one. Connection retains a usable port for as long as possible and may
preserve it across repeated participating-document replacements. If the port
cannot continue across a document change, connection transparently establishes
another carrier or fails closed.

The controls below are package-private carrier mechanics, not caller messages,
public APIs, extension points, or durable state.

## Boundary

The carrier begins with connection-supplied browser handles, expected origins,
connection version, the already-validated
[connection ID](connection.md#connection-id), and internal cancellation signal.
It ends with one authenticated local `MessagePort` at each endpoint.

Within that boundary it owns:

- validation of browser-stamped `MessageEvent.source` and
  `MessageEvent.origin`;
- one `MessageChannel`, one transfer of its popup endpoint, and the lifetime
  of both local endpoints;
- preservation of an authenticated port across immediate participating-document
  replacement; and
- adaptation of an accepted port to the connection's typed delivery API.

The connection owns carrier selection, the decision to navigate, and the
logical connection. The caller owns every transported value and its meaning.
The carrier neither interprets those values nor persists or recovers them.

## Failure and security invariants

- An event is a handshake attempt only when its data is a plain record whose
  `type` is `message-port` and whose `connectionId` equals this connection's.
  Every other event is ignored, including a valid handshake for another
  connection ID and unrelated traffic from the bound `WindowProxy` while it
  shows a non-participating document, so concurrent connections never reject
  each other and a provider page cannot terminate the connection. An attempt
  must then exact-match its browser-stamped origin, source (the bound
  `WindowProxy` after binding), record shape, direction, and connection
  version. The popup additionally requires exactly one transferred port.
- The wildcard-targeted request contains no capability or application-level
  value. The response targets the request's exact browser-stamped allowed popup
  origin, transfers only the new popup endpoint, and never exposes the
  application's retained endpoint. After
  validating that response, the popup echoes the same handshake record over the
  transferred port; the application does not select the port before that echo.
- Any handshake attempt which fails those checks rejects the binding and closes
  every reachable port. The application's window listener lives for the
  connection; an accepted handshake discards only that attempt's state, and a
  later handshake from the bound source starts a new attempt. The popup removes
  its own window listener after acceptance; later window traffic there is
  inert.
- After binding, possession of the entangled port authenticates the peer.
  Application-level values travel only over that port; the carrier preserves
  their order and shape without interpreting them.
- Abort, timeout, `messageerror`, port closure, or browser-context destruction
  closes reachable resources and releases no later value. There is no
  reconnect, resend, or recovery inside this carrier.
- Port loss may be silent. It is a connection failure, never delivery, success,
  denial, cancellation, or any other caller outcome.

## Authentication

Both directions use one carrier-local record:

```ts
interface MessagePortHandshake {
  type: 'message-port'
  connectionVersion: ConnectionVersion
  connectionId: string
}
```

The returned popup sends the record with its connection ID and no transferable.
The ID is public correlation, not a capability or caller-level value. The
application accepts it only from its retained popup source, or binds the
browser-stamped source once in the native-anchor fallback, and only when the
browser-stamped origin is in its immutable allowed popup-origin set and the
connection version and connection ID exact-match.

The application creates one `MessageChannel`, retains one endpoint, and sends
the same record back with the live connection ID and the other endpoint as its
only transferable. The popup accepts it only from its exact opener and a
browser-stamped origin in its immutable allowed-origin set, and only when the
connection version and connection ID match its current binding. It rejects a
missing or additional port.

After accepting the response, the popup starts the transferred port and sends
the same `MessagePortHandshake` record over it as the final establishment
acknowledgement. The application exact-checks that record on its retained port
before resolving its pending operation. This reuses the carrier-local handshake
shape; it is not a caller message or an additional protocol control. A missing,
malformed, duplicate, or mismatched acknowledgement closes both reachable
endpoints and selects no carrier.

The request may use an unrestricted target origin because it contains no
capability or application value. The response targets the exact observed popup
origin after admission.
Application-level delivery starts only after the final acknowledgement; its
position on the ordered port keeps every later caller value behind it.

## Message delivery

`PortCarrier` passes each logical value directly to
`MessagePort.postMessage`. Native structured clone preserves arrays, plain
records, and `Uint8Array`; this carrier adds no JSON encoding, byte tag,
normalization, or additional copy. Received `MessageEvent.data` remains
`unknown` until the connection selects and applies its registered `MessageType`.
A successful decode returns that same received object rather than allocating a
replacement. A `DataCloneError` or `messageerror` closes the carrier. A failed
decode makes the connection close it. None releases a value.

## Continuity across navigations

Replacing a popup document normally destroys its side of the communication
channel together with its JavaScript heap. A live `MessagePort` owned only by
that document becomes unreachable, while the destination document does not yet
exist and cannot receive it directly. The carrier gives the port a temporary
same-origin Service Worker owner across that gap:

```text
source document          Service Worker          destination document
      |                         |                           |
      |--- keep(port) --------->|                           |
      |<-- ownership accepted --|                           |
      |--- navigate --------------------------------------->|
      |                         |<-------- claim(port) ------|
      |                         |-------- port ------------->|
```

The source navigates only after the worker acknowledges ownership. The
destination claims before loading caller code or using the network. This
preserves the already authenticated port without repeating its handshake.
`PortKeeper` never receives an RTC resource, substitute carrier, or caller
value.

This path is strictly same-origin. The host must serve source and destination
under the same active Service Worker registration and scope when it expects
preservation. Connection can check only the target origin before navigation; if
a same-origin destination resolves to another registration, it claims no port
and performs a fresh handshake through its opener or fallback. Before
cross-origin navigation, including navigation to another site, connection does
not call `keep`; it releases the old popup endpoint and the allowed destination
likewise establishes a fresh carrier.

This is a short in-memory continuity bridge, not persistence or recovery.
Worker loss breaks continuity; no later document can reconstruct or resume the
channel.

### Timing assumptions and browser limits

For every participating-document replacement, the bridge must complete within
its bounded interval. The same logical connection may use it repeatedly. After
the worker acknowledges preservation, the source starts navigation immediately
and the destination calls `PopupConnection.accept` before any other network
use; the claim is its first step, so the deadline includes document load and
package import. It never holds a port while an unrelated document, user
interaction, or intentional background wait owns the popup; a later
participating document establishes a replacement carrier.

The `keep` handler uses `event.waitUntil()` to keep its message event active
until the port is claimed or its short deadline expires. Its acknowledgement
therefore confirms worker ownership but does not end the event. `claim`
atomically transfers the port and settles that event. The Service Worker
lifetime model remains event-based: registrations persist, but a worker heap
may be terminated when no event is pending or under abnormal resource pressure.

There is no portable browser-specific minimum lifetime. The PoC observed:

| Browser engine | Empirical hold result |
|---|---|
| Chromium | More than 60 seconds; the upper boundary was not found. |
| Firefox | Approximately 60 seconds. |
| Playwright WebKit | Seven seconds succeeded and eight seconds lost the port. |

These are observations, not guaranteed browser contracts. The carrier uses one
conservative `CARRIER_CLAIM_TIMEOUT_MS = 5_000` across engines, below the
observed WebKit boundary. It does not sniff the user agent or select a
browser-specific deadline. Suspension, process loss, memory pressure, or expiry
may still break continuity; failure is terminal and never selects a weaker
path.

### Internal PortKeeper API

`PortKeeper` is the carrier's package-private continuity component. It
encapsulates Service Worker communication, temporary ownership, event lifetime,
the claim deadline, one-use transfer, and cleanup. It neither reads the port nor
knows what it carries.

The worker itself is host-owned. The host is the deployment serving the popup
documents. A Service Worker script must be served from that origin, so the host
registers one for its popup documents and calls `installPortKeeper()` from
that script. The handler is exported from the `@libid/popup/worker` subpath
only, so worker-global types never enter the main package declaration. The
package registers nothing and `PopupWindow.current()` resolves the active
registration whose scope matches the current document; control of the
document is not required to message that worker.

```ts
// @libid/popup/worker
declare function installPortKeeper(): void

declare class PortKeeper {
  constructor(worker: ServiceWorker)

  keep(connectionId: string, port: MessagePort): Promise<void>
  claim(connectionId: string): Promise<MessagePort | null>
}
```

The constructor fixes the active worker for both operations; the connection
version is the package constant. `keep` resolves only after the worker owns the exact port, after
which connection may replace the source document. `claim` atomically returns
and removes the unchanged port, or returns `null` when no entry exists. `null`
authenticates and selects nothing; popup construction continues with its
available browser resources. A returned port is the selected carrier endpoint.

The two acknowledged calls are necessary because the worker must own the port
before the source document destroys itself and the destination document does
not yet exist. The Service Worker record and control-message encoding are
implementation details. Connection version, connection ID, transferable
count, duplicate ownership, and one-use claim are checked before ownership
changes. A malformed, mismatched, or duplicate record rejects and closes every
reachable port. Expiry deletes the entry and closes its port; an expired or
already-claimed entry is absent and yields `null`, the worker keeps no record
of it. Worker loss or a failed `keep` acknowledgement prevents navigation with
live state. No `BroadcastChannel`, cookie, IndexedDB record, request, or URL
carries the port.

Each operation carries its own reply `MessagePort` and waits at most
`KEEPER_REPLY_TIMEOUT_MS = 2_000` for the worker's answer. The popup resolves
the matching registration when it needs it rather than once at construction:
the host may register the worker in the same document after `accept` has
started, so preservation waits up to the reply deadline for a worker that is
still installing and fails closed if none activates. A claim only ever asks
an already active worker, since only that worker can hold a port.

## API

The application starts listening before the popup endpoint is ready:

```ts
declare function listenForPopupPorts(
  options: {
    view: Window
    source: WindowProxy | null // retained handle, or null until native-anchor binding
    onBind: (source: WindowProxy) => void
    allowedPopupOrigins: readonly string[]
    connectionId: string
  },
  handlers: {
    onPort: (port: MessagePort) => void
    onFail: () => void
  },
): () => void

declare function requestApplicationPort(options: {
  view: Window
  opener: WindowProxy
  allowedOrigins: readonly string[]
  connectionId: string
  signal: AbortSignal
  timeoutMs?: number
}): Promise<MessagePort>

declare class PortCarrier implements Carrier {
  constructor(port: MessagePort)
  /** Hands the port to `PortKeeper.keep` and closes this carrier. */
  detach(): MessagePort
}
```

`listenForPopupPorts` installs one window listener synchronously for the
connection lifetime and sends nothing. When `PopupWindow` retained a handle it
requires that exact source; otherwise it binds `PopupWindow` to the source of
the first handshake whose observed origin is allowed and which exact-matches
the connection version and connection ID, and requires that source afterwards.
Each accepted handshake creates one channel, responds with the popup endpoint,
awaits the echo, and then reports the retained endpoint through `onPort`; the
connection installs it and closes the previous carrier. A newer accepted handshake
supersedes one still awaiting its echo. This replacement is private connection
machinery; callers continue using the same `PopupConnection`.

When the popup endpoint is ready, it calls and awaits
`requestApplicationPort`. It sends the handshake request; the listening
application validates it, creates the channel, and sends the response with the
popup endpoint. The popup validates that response, sends the same handshake
record over the transferred port, and resolves with that endpoint. A handshake
attempt from the opener that fails authentication rejects immediately; abort
and the `OPENER_HANDSHAKE_TIMEOUT_MS` deadline also reject. Every rejection
removes the window listener and closes every reachable port. The concrete
error type is private. `PortCarrier` starts the port, forwards unchanged
structured-clone values, closes idempotently, and `detach` surrenders the
port for preservation.
