# @libid/popup

[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Flibid-org%2FlibID%2Fbadges%2Fpopup-coverage.json)](TEST_PLAN.md)

Let two websites run an interactive protocol together while keeping each
site's memory and persistent states isolated.

Use this primitive when an application needs to talk to another site in a
popup or browser tab: identity proving, an in-browser wallet, state
synchronization, or multiparty computation.

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
need a caller-supplied fallback.

## Use and develop

- [API guide](docs/api.md) — popup creation, connections, messages, navigation, failures, and workers.
- [Connection](docs/connection.md) — origin policy, authentication, and lifecycle.
- [MessagePort](docs/message-port.md) and [WebRTC](docs/webrtc.md) — communication carriers and continuity.
- [Popup control](docs/control.md) — navigation and closure.
- [Metrics and diagnostics](METRICS.md) — local observability.
- [Test plan](TEST_PLAN.md) — coverage and manual checks.

Run from this package:

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
```

Unit tests use real `MessageChannel` ports; browser tests run the Playwright matrix.
