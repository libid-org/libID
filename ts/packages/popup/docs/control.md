# Popup control

This document defines popup navigation and the control protocol by which an
application asks its connected popup to navigate or close itself, and the popup
reports an unexpected document departure.
It is independent of caller protocols: navigation and popup lifetime are
composition decisions, not protocol results.

## Rationale

A popup may become a top-level cross-origin-isolated document. Its COOP policy
may sever the application's `WindowProxy`, so later
`popup.location.replace(...)` and `popup.close()` calls are not reliable.
The isolated popup can still navigate or close itself, and its selected
connection remains usable across the browsing-context-group split. A connected
navigation therefore carries the application decision over that connection and
lets the popup prepare continuity before replacing itself, even while its old
`WindowProxy` still appears usable. Close control covers the later case where
that handle is absent or reports closed. This requires no app-origin return or
second popup.

## Records

```ts
interface Navigate {
  type: 'navigate'
  url: string
}

interface ClosePopup {
  type: 'close-popup'
}

interface DocumentDeparted {
  type: 'document-departed'
}

type PopupControl = Navigate | ClosePopup | DocumentDeparted
```

These discriminators are connection-reserved. They cannot appear in a
composition-owned message union or caller registration.

Each discriminator is its own compatibility boundary. An incompatible shape or
semantic change introduces a new message and decoder rather than a shared
protocol-version field. Unknown controls fail closed.

Navigation and close commands are Application → Popup; departure is Popup →
Application. The receiver exact-validates a
plain record, discriminator, and field set before acting. They travel only over
an already version-authenticated carrier. A navigation
URL must equal the serialization of an absolute URL with no credentials,
using HTTPS or HTTP on exactly `localhost` or `127.0.0.1` at any valid port;
it may carry a fragment, which is the application's serialized fragment fields.
Relative, disallowed-HTTP, malformed, and noncanonical URLs fail closed. Connection
owns the generic message bound.

## Execution

`PopupConnection.navigate(url)` and `PopupConnection.navigateAway(url)` are
available on both endpoints. `PopupConnection.close()` is the
application-facing lifetime operation.

While native-anchor binding is pending, `navigate` performs no browser
operation and leaves that same activation's default navigation intact. With an
active carrier, the application endpoint sends `Navigate`; without one, it uses
the exact retained `WindowProxy` only while the handle is non-null and not
closed. A popup endpoint calling `navigate` acts locally and sends no
`Navigate`. In either popup-side path, the endpoint stops accepting controls,
preserves a same-origin transferable carrier, releases it for cross-origin
rebind including across sites, or prepares a nontransferable replacement as
required, then calls `location.replace(url)`. Replacement avoids adding the
current document to popup history and creates no browsing context. Failure to
preserve or prepare a carrier rejects before navigation.

`navigateAway` never sends `Navigate`. On the application side it navigates
the exact retained `WindowProxy` while that is non-null and not closed,
retires the current carrier without preservation, and leaves the application
endpoint armed for the next participating document; it rejects once the handle
is unusable. On the popup side it releases the carrier and calls
`location.replace(url)` without preparing continuity. It exists for
non-participating destinations, where preservation would only expire, and it
keeps the destination private: no `navigate-away` control exists because the
URL must never cross a carrier, so an isolated popup leaves on its own
initiative. A cross-origin rebind
may fail only after the destination loads; that failure releases no caller
value and selects no weaker carrier. The caller commits its state and clears
sensitive inputs before requesting navigation.

When the exact retained `WindowProxy` is non-null and not closed, `close` calls
it directly, regardless of carrier state. Otherwise it sends `ClosePopup` over
an active carrier. It then closes the logical connection and releases its local
resources. The receiving popup stops accepting controls and calls
`window.close()` on itself. The composition MUST expose and invoke
this operation only for a separate top-level traversable created by
`window.open()` or an activated link. Both creation paths produce a
script-closable traversable, including when the browser presents it as a tab,
and that property survives provider navigation and a COOP browsing-context
group switch. A same-tab or full-page presentation MUST NOT send
`ClosePopup`. This is a window-creation invariant; there is no reliable post-COOP
runtime probe for script closability.

The first accepted navigation or close command is terminal and one-shot for its receiving
document. `Navigate` may continue the logical connection in the destination;
`ClosePopup` terminates it. A duplicate, replay, race loser, unknown control,
wrong-direction record, or record on another connection performs no browser
operation.

None of these control messages has a remote acknowledgement. A pending native-anchor
call resolves after the connection accepts that the same activation owns the
navigation; it does not claim that navigation was observed. Navigation can destroy
the receiver and COOP prevents the application from reliably observing either
browser action. Each promise therefore means only that the direct browser
operation was invoked or the local connection accepted its control for ordered
delivery. The composition must commit the authoritative successor state before
acting and treat connection loss or an unavailable popup as neither success,
cancellation, nor proof of delivery.

## Document departure

`DocumentDeparted` is sent only Popup → Application over the selected
authenticated carrier. It carries no caller data.
The application settles `closed` once and releases the connection, without
attempting to close the browser window or interpreting the departure as denial.
A notification from a retired carrier cannot terminate a successor connection.

A popup sends it on explicit local close or unexpected `pagehide`. A non-cancelling
`beforeunload` listener keeps WebKit's window-close lifecycle running; it sends
nothing and never prompts. Both listeners are removed before planned navigation.
While attached, `beforeunload` may prevent Firefox's back/forward caching; it does
not change the protocol's document replacement or best-effort mobile guarantees.

Package-owned navigation and isolation fallback suppress it, including when continuity work
is still pending. A failed send is inert: no acknowledgement, retry or secondary
failure is possible. `pagehide` can mean close, reload or Back and may be skipped
by mobile termination. Non-participating provider pages send nothing. Neither a
COOP-severed handle nor a silent carrier establishes document departure.

## Unavailable window

Provider documents cannot send `DocumentDeparted`. The application polls its
retained handle every 250 ms. Without a carrier, pending authenticated handshake,
or pending fallback, an unavailable handle terminates the connection with
`popup-unavailable` on the
first observation. This means closure or opener severance (including COOP), not
a confirmed physical close or denial. The application never closes the window
as a side effect of this failure.

A selected carrier suppresses this check, including through package-owned
isolation. A pending fallback keeps the connection recoverable indefinitely;
resolution installs its authenticated carrier, rejection removes the remaining
fallback, and explicit close aborts recovery. Native-anchor launch has no handle
to poll until its first authenticated binding. Terminal cleanup stops polling.

## Security boundary

- Only the application endpoint of the selected connection can send navigation
  or close commands; only the popup can report document departure. In either case,
  cookies, URLs, storage, opener state, and caller payload fields cannot
  authorize one.
- The connection binding prevents one concurrent operation from
  controlling another popup.
- Popup control does not encapsulate caller messages. An application-selected
  navigation intentionally carries its URL and fragment to the popup;
  popup-local navigation sends neither to the application. Disclosure policy
  belongs to the caller.
- A caller-protocol value never selects a destination. Only the independently
  decoded `Navigate` control can do so.
- Failure cleanup remains resource-only and never synthesizes `ClosePopup`
  or calls `window.close()`; only an explicit application-side `close()` does.
