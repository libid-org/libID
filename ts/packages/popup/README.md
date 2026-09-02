# @libid/popup

`@libid/popup` owns one popup browsing context from creation or adoption through
navigation and closure. It connects that popup to an application page across a
caller-approved set of origins, external navigation, isolation boundaries,
mobile suspension, and popup-document replacement, carrying caller-defined
messages without owning or naming the caller protocol.

The detailed design is split into the [popup connection](docs/connection.md),
its [MessagePort](docs/message-port.md) and [WebRTC](docs/webrtc.md) carriers,
and [popup control](docs/control.md).
Acceptance is indexed by the [test plan](TEST_PLAN.md), while
[metrics and diagnostics](METRICS.md) defines local observability.

## API

### Open the popup

The application creates a lifecycle object during the user activation. It then
constructs the connection before deciding whether to suppress the action's
native navigation:

```ts
const popupWindow = PopupWindow.open(anchor.target)
const connection = PopupConnection.connect<Messages>(popupWindow, {
  connectionId,
  allowedPopupOrigins,
  fallback,
  onDiagnostic,
})

void connection.navigate(anchor.href)
if (popupWindow.opened) event.preventDefault()
```

`PopupWindow.open(target)` synchronously attempts
`window.open('about:blank', target)` and returns a wrapper even when the browser
returns no handle. It throws `TypeError` before opening for an empty target or
one beginning with `_`. When no handle is returned, the connection binds the
popup created by the same action's real anchor. See [popup creation and
native-anchor fallback](docs/connection.md#popup-creation-and-native-anchor-fallback).

```ts
declare class PopupWindow {
  readonly opened: boolean

  static open(target: string): PopupWindow
  static current(): PopupWindow
}
```

`PopupWindow` exposes no direct navigation or closure; both go through
`PopupConnection` so continuity and control rules always apply.
`PopupWindow.current()` wraps the current popup document, its opener, and the
active Service Worker registration whose scope matches that document. It
adopts the existing popup and cannot create another one.

### Connect from the popup

Each participating popup document accepts its side of the same logical
connection:

```ts
const popupWindow = PopupWindow.current()
const connection = await PopupConnection.accept<Messages>(popupWindow, {
  connectionId,
  allowedApplicationOrigins,
  fallback,
  onDiagnostic,
})
```

The caller supplies a fresh `crypto.randomUUID()` value for each logical
connection; the exact accepted grammar and non-reuse rule are defined by the
[connection ID contract](docs/connection.md#connection-id).

`PopupConnection` retains a usable carrier for as long as possible and may
preserve, transfer, or replace it transparently across document changes. If no
carrier can continue or be established, the logical connection fails closed.
Same-origin replacement may preserve a `MessagePort` through the continuity
worker. Cross-origin replacement, including navigation to another site, never
transfers a port between Service Workers: the next participating document
authenticates a fresh carrier through its opener or the configured fallback.
A cross-origin destination whose isolation policy severs its opener therefore
requires a fallback constructor; without one, the connection fails closed.

```ts
interface PopupConnection<M extends Message> {
  send(message: M): void
  on<N extends M>(
    message: MessageType<N>,
    handler: (message: N) => void,
  ): () => void
  navigate(url: string): Promise<void>
  close(): Promise<void>
}
```

Before carrier selection, `navigate` uses the retained popup handle when
available. Once a carrier is active, the application endpoint sends navigation
control over it; popup-endpoint navigation acts locally. `close` uses an
available retained handle and otherwise uses popup control, then releases both
the connection and popup.

### Define and exchange messages

Each caller-owned message class supplies its discriminator and decoder:

```ts
interface Message {
  readonly type: string
}

interface MessageType<M extends Message> {
  readonly type: M['type']
  decode(value: unknown): M
}

class PopupReady implements Message {
  static readonly type = 'popup-ready'
  readonly type = PopupReady.type

  constructor(readonly version: number) {}

  static decode(value: unknown): PopupReady {
    assertPopupReady(value)
    return value
  }
}

type Messages = PopupReady

connection.on(PopupReady, ready => {
  // ready is PopupReady
})

connection.send(new PopupReady(1))
```

Higher-level popup logic combines these classes into its own union and supplies
that union to `PopupConnection`. Lifecycle controls remain internal and never
reach caller handlers. Register handlers synchronously after `connect` returns
or `accept` resolves: inbound values dispatch as later tasks, and a value with
no registered handler closes the connection. `send` throws synchronously
without an active carrier or after closure; nothing is queued.

### Diagnostics

Both connection constructors accept an optional local diagnostic sink:

```ts
interface PopupDiagnostic {
  readonly code: string
  readonly timestamp: number
  readonly durationMs?: number
  readonly count?: number
}
```

`code` is one of the stable identifiers catalogued in
[metrics and diagnostics](METRICS.md); the set grows with new carriers.

### Continuity worker

Connected same-origin navigation between participating popup documents
preserves the MessagePort through a Service Worker on that origin. The host,
the deployment serving the popup documents, registers that worker and calls
the handler from the `@libid/popup/worker` subpath in its worker script; the
package registers nothing and the main entry exports no worker-global types:

```ts
// popup-origin worker script
import { installPortKeeper } from '@libid/popup/worker'

installPortKeeper()
```

`accept` claims a preserved port from the active registration matching the
current document as its first step, so the host calls it before any other
network work. See [continuity across navigations](docs/message-port.md#continuity-across-navigations).

### Fallback carrier

The optional fallback is a carrier constructor supplied independently in every
participating document:

```ts
type CarrierConstructor = (signal: AbortSignal) => Promise<Carrier>

interface Carrier {
  send(value: Message): void
  on(handler: (value: unknown) => void): () => void
  close(): void
}
```

Omitting it starts no fallback work. If opener-based connection fails, the
connection terminates with the stable `fallback-unavailable` diagnostic. The
WebRTC application constructor closes over its own signaling and ICE
configuration. Its popup-side factory eagerly consumes package-owned navigation
metadata and returns the later constructor without starting RTC. Callers do not
manage carrier selection, replacement, or lifetime.

## Testing

`pnpm test` runs the unit suite in Node over real `MessageChannel` ports.
`pnpm test:e2e` builds the package and its worker entry, serves three
cross-site HTTPS origins, and drives the Playwright matrix (Chromium, Firefox,
WebKit, mobile Chrome, mobile WebKit) through both creation paths, isolation
round trips over one preserved port, port expiry, and every fail-closed path.
[TEST_PLAN.md](TEST_PLAN.md) records which rows each layer covers and which
remain deferred or manual.
