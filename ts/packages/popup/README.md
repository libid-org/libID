# @libid/popup

Let two websites run an interactive protocol together while keeping their
state separate.

Use this primitive when an application needs to talk to another site in a
popup or browser tab: identity proving, an in-browser wallet, state
synchronization, or multiparty computation. It works independently of
libID's identity ceremonies and requires no browser extension.

## How it works

A state machine on site A opens a bidirectional channel to one on site B.
Each side authenticates the other's origin, and the browser's same-origin
policy isolates their memory and storage. The popup uses its own top-level
browsing context and first-party storage; data retention follows the
browser's storage policies.

The package manages popup creation, navigation, document replacement, and
connection lifetime across desktop and mobile browser behavior. Applications
supply their messages and protocol logic, including what data to share and
how to verify it.

Connection continuity is best effort: applications must handle failures and
possible message loss when a carrier changes. Opener-independent connections
need a caller-supplied fallback; the [WebRTC carrier](docs/webrtc.md) is
specified but not implemented yet.

## API

The [API guide](docs/api.md) covers opening a popup, connecting both sides,
exchanging messages, navigation, failure handling, and worker setup.

## Design

- [Connection](docs/connection.md) — origin policy, authentication, and lifecycle.
- [MessagePort](docs/message-port.md) and [WebRTC](docs/webrtc.md) — communication carriers and continuity.
- [Popup control](docs/control.md) — navigation and closure.
- [Metrics and diagnostics](METRICS.md) — local observability.

## Testing

From this package, `pnpm test` runs the unit suite over real `MessageChannel`
ports; `pnpm test:e2e` runs the Playwright browser matrix.
The [test plan](TEST_PLAN.md) records coverage and deferred or manual checks.
