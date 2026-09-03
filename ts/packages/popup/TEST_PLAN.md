# `@libid/popup` test plan

These tests qualify popup lifecycle, connection, carriers, continuity, and
control independently of any protocol transported by the package.

Coverage status:

- **Unit** (`pnpm test`, vitest in Node over real `MessageChannel` ports with
  in-memory window and worker-scope fakes): every API, WINDOW, CONTROL,
  CONNECTION, PORT, KEEPER, and DIAGNOSTIC row except the clauses below.
- **Browser** (`pnpm test:e2e`, Playwright on Chromium, Firefox, WebKit,
  mobile Chrome, and mobile WebKit emulation over three cross-site HTTPS
  origins): popup creation on both paths, opener authentication, connected
  navigation into and out of a COOP-isolated document over one preserved
  port, a cross-site hop between participating documents that re-handshakes
  over the opener, close after the opener is severed, port expiry across a
  non-participating hop, and every fail-closed path.
- **Deferred**: every POPUP-RTC row; no WebRTC carrier exists yet.
- **Manual**: POPUP-BROWSER-001/002, the delayed-activation clause of
  POPUP-WINDOW-003 (Playwright runs no popup blocker), the suspension clause
  of POPUP-CONNECTION-006, and the suspension and process-loss clauses of
  POPUP-KEEPER-003.

## API and message delivery

| ID | Assertion |
|---|---|
| POPUP-API-001 | A caller-defined message union is accepted by `PopupConnection<M>` without entering package-owned source, and `send` rejects the reserved `navigate` and `close-popup` discriminators. |
| POPUP-API-002 | `on` registers one class per discriminator, rejects duplicates, calls its static `decode` exactly once, returns the same decoded object, and unsubscribes only that handler. |
| POPUP-API-003 | Unknown, unregistered, malformed, or decoder-rejected input closes the connection and reaches no caller handler. |
| POPUP-API-004 | Concurrent connections keep message registrations, native resources, controls, and delivery isolated by connection ID; before native-anchor binding, a valid handshake for another connection ID is ignored rather than rejected. |
| POPUP-API-005 | The emitted `PopupWindow` declaration omits internal `bind`; package source invokes it only after exact native-anchor validation. |

## Popup window and control

| ID | Assertion |
|---|---|
| POPUP-WINDOW-001 | `PopupWindow.open(target)` synchronously attempts one named `about:blank` popup and retains the returned `WindowProxy`; it creates no second browsing context. |
| POPUP-WINDOW-002 | When scripted opening returns `null`, the same activation's real anchor retains its navigation, and only an exact initial source/origin/version/connection binding marks the wrapper opened. |
| POPUP-WINDOW-003 | `PopupWindow.open` throws `TypeError` for an empty target and every target beginning with `_` before invoking `window.open`; `noopener`, `noreferrer`, delayed synthetic activation, a wrong source, and an opaque sandbox origin cannot bind the native-anchor path. |
| POPUP-WINDOW-004 | Popup presentation as a window or tab changes no connection, storage, recovery, or control rule; `closed` selects only whether a no-carrier direct operation can be attempted and never becomes a protocol result. |
| POPUP-CONTROL-001 | While native-anchor binding is pending, `navigate` performs no browser operation and leaves the same activation's default navigation intact. Without an active carrier, `navigate` and `close` use the retained handle only while it is non-null and not closed and emit no control message. |
| POPUP-CONTROL-002 | With an active carrier, application-endpoint `navigate` sends one exact canonical-HTTPS `Navigate` even while its retained handle appears usable; popup-endpoint `navigate` sends no control. Either popup-side path invokes replacement only after carrier continuity is preserved or prepared; malformed, credentialed, noncanonical, relative, non-HTTPS, and unpreparable navigations fail before browser navigation. Real-engine tests confirm a COOP-severed retained handle reports `closed`. |
| POPUP-CONTROL-003 | `close` uses a non-null, non-closed retained handle directly regardless of carrier state and otherwise sends one `ClosePopup` over an active carrier. It closes local resources, is idempotent, and is accepted only for a package-created script-closable popup. |
| POPUP-CONTROL-004 | Controls carry no version field because they travel only over a version-authenticated carrier. They are application-to-popup, one-shot per receiving document, unacknowledged, connection-bound, and private; wrong-direction, duplicate, replayed, unknown, and post-terminal controls perform no browser operation. `Navigate` may continue the logical connection in its destination, while `ClosePopup` terminates it. |

## Carrier authentication and selection

| ID | Assertion |
|---|---|
| POPUP-CONNECTION-001 | A carrier becomes selectable only after it authenticates both browser endpoints; origin, source, connection ID, connection version, and direction mismatches release no caller value. |
| POPUP-CONNECTION-002 | The popup selects the path for each participating document; the application never runs an independent first-promise-wins race. MessagePort becomes selectable on the application only after the popup's exact port acknowledgement. An absent, severed, or timed-out opener commits fallback, while an authentication failure is terminal. Installing a new document's authenticated carrier atomically closes the obsolete carrier; a failed active carrier never initiates fallback by itself. |
| POPUP-CONNECTION-003 | One logical connection survives repeated participating-document replacements: `navigate` preserves a usable carrier when possible and otherwise replaces it transparently; callers never manage carrier identity, count, lifetime, or reconnection. If no carrier can continue or be established, the connection fails closed. |
| POPUP-CONNECTION-004 | `connect` invokes a supplied fallback constructor exactly once with the connection-lifetime signal and observes its promise without awaiting it; `accept` invokes its constructor once only after MessagePort becomes unavailable. The constructor returns only an authenticated `Carrier`; connection creates no substitute `MessageChannel` and queues no caller value outside that carrier. MessagePort selection retains the unused application fallback. No-carrier navigation arms only a fresh document-local MessagePort operation; popup-side navigation from RTC uses its package-private lifecycle hooks to prepare the target and retain a pending replacement before navigating, then installs only its authenticated result. Connection closure aborts every pending operation. |
| POPUP-CONNECTION-005 | Without a fallback constructor, successful MessagePort use emits no fallback diagnostic; fallback selection records exactly one sanitized `fallback-unavailable` failure and closes. |
| POPUP-CONNECTION-006 | Carrier loss, endpoint loss, popup closure, background suspension, and continuity loss are never delivery, cancellation, success, or recovery. Resumed delivery preserves order. While the popup is non-participating after a connected navigation, every `send` and `navigate` succeeds locally and delivers nothing. |
| POPUP-CONNECTION-007 | Both constructors accept an exact lowercase RFC 4122 UUIDv4 `connectionId` and reject uppercase, noncanonical, malformed, wrong-version, and wrong-variant strings before carrier, keeper, or signaling work. Caller integration generates a different `crypto.randomUUID()` value for every logical connection and never reuses a retired value. |
| POPUP-CONNECTION-008 | `PopupConnection.navigate()` directly between same-origin participating documents preserves a MessagePort or prepares a nontransferable carrier. Across origins, including across sites, it never gives a MessagePort to the source origin's worker: it retires that popup endpoint and the allowed destination establishes a fresh carrier through its opener or fallback. A navigation outside that API loses the current carrier. A later participating document may establish the first RTC carrier from the still-unused initial fallback without round metadata; after RTC is active, an unmanaged navigation terminates the logical connection without restarting round zero. |
| POPUP-CONNECTION-009 | `connect` and `accept` copy nonempty, duplicate-free sets of canonical HTTPS `allowedPopupOrigins` and `allowedApplicationOrigins`, respectively. Every initial, native-anchor, replacement, MessagePort, and RTC participant binds one exact browser-observed member of the peer's set. Sequential popup participants may use different admitted origins without changing the logical connection ID or caller registrations. An empty set or duplicate, malformed, noncanonical, credentialed, or unapproved origin fails before selection or caller delivery. |

## MessagePort and navigation continuity

| ID | Assertion |
|---|---|
| POPUP-PORT-001 | The popup initiates one private handshake; the application exact-checks source, membership of the browser-stamped origin in `allowedPopupOrigins`, connection ID, connection version, and direction before transferring exactly one `MessagePort` back to that exact observed origin. The popup validates the response and echoes the same handshake record over the ordered port. Only an exact final acknowledgement resolves the application operation and makes MessagePort selectable; missing, malformed, duplicate, or mismatched acknowledgement selects nothing. The application listener accepts sequential handshakes from different allowed popup origins over the connection lifetime, discarding only per-attempt state, and ignores any event lacking the discriminator and matching connection ID. |
| POPUP-PORT-002 | The selected port carries ordered, nonduplicated structured-clone values. Delivery performs no serialization or allocation before the registered message decoder. |
| POPUP-KEEPER-001 | `keep` acknowledges only after the worker owns one exact port; navigation begins only after that acknowledgement, and `claim` atomically transfers and removes it. |
| POPUP-KEEPER-002 | Duplicate, mismatched-version, mismatched-ID, or malformed keep/claim operations fail and close every reachable port; an expired or already-claimed entry is absent and yields `null`. The host-registered worker handles keep/claim only through `installPortKeeper` from `@libid/popup/worker`. |
| POPUP-KEEPER-003 | Chromium, Firefox, and WebKit real or qualified emulation preserve the port across immediate same-origin document replacement below the common five-second deadline when both documents resolve the same active Service Worker registration and scope. A different same-origin registration claims no port and safely re-handshakes. Cross-origin replacement never invokes `keep` and establishes a fresh carrier; no port or keeper survives a non-participating external document or unbounded wait, and expiry, worker termination, suspension, and process loss fail without recovery. |
| POPUP-KEEPER-004 | Continuity preserves an authenticated MessagePort unchanged. WebRTC and caller values never enter `PortKeeper`; it stores no caller value in a URL, request, cookie, IndexedDB, or other durable record. |

## WebRTC fallback

Deferred until the WebRTC carrier is implemented; no row below is claimed.

| ID | Assertion |
|---|---|
| POPUP-RTC-001 | `connect` invokes the application fallback exactly once and starts bounded one-use answerer round zero before the first popup navigation. It keeps that round armed across any number of MessagePort-selected documents until consumed, failed, abandoned, or connection closure; no later fallback invocation can restart round zero. The destination popup constructor creates the offerer only after fallback selection. Each RTC replacement creates fresh peers, offer, answer, and ICE state under the same logical connection ID and exactly incremented round. |
| POPUP-RTC-002 | Signaling exact-checks each endpoint's browser-stamped origin against its immutable admission set and binds one exact application and popup origin for the round, along with connection version, connection ID, unsigned 32-bit round, and role on every record. Connection ID is randomized correlation and grants no authority without the authenticated endpoint origin and role. At most one round per connection ID is live, and its records are bounded, one-use, transient, and contain no caller message. Delayed offers, answers, candidates, and cleanup from round N are rejected after round N+1 starts. |
| POPUP-RTC-003 | Both peers use trickle ICE with configured STUN and one ordered reliable data channel without requiring mDNS, local-network permission, ICE gathering completion, or TURN. Direct-path failure closes the carrier. |
| POPUP-RTC-004 | The codec round-trips its closed JSON/`Uint8Array` value domain. Invalid UTF-8, JSON, byte tags, frame order or length, sparse or unsupported values, oversize, and buffer overflow reach no connection decoder. |
| POPUP-RTC-005 | MessagePort selection leaves an unused application answerer round armed and creates no popup peer. Abort, signaling failure, ICE failure, unexpected data-channel loss, or connection closure deletes the current round and closes every reachable peer and channel without reconnecting or resending. Only a fresh participating popup document or controlled RTC navigation may select or prepare an RTC carrier. |
| POPUP-RTC-006 | An RTC carrier exposes both exact package-private lifecycle symbols and no public navigation API. Popup-side `prepareNavigation(target)` sends `PrepareNavigation`; the selected application carrier internally starts exactly current round plus one, reports only its pending authenticated carrier through the one registered `onReplacement` handler, and sends `NavigationReady(nextRound)` only after its subscription is armed. The popup carrier returns the target with its private fragment field, after which connection may navigate and later install only the authenticated replacement carrier. Before `PopupConnection.accept`, the destination's popup WebRTC factory copies and clears the field and returns the later constructor without signaling. MessagePort selection therefore leaves no package field and starts no popup RTC peer. No round reaches connection, and neither lifecycle hook nor private control reaches `PopupControl`, caller handlers, the generic carrier value stream, or a MessagePort carrier. |
| POPUP-RTC-007 | Missing where required, duplicate, misplaced, malformed, noncanonical, negative, fractional, out-of-range, stale, unexpected, skipped, repeated, or overflowing navigation rounds fail without signaling, caller delivery, or browser navigation. Neither round metadata nor the connection ID grants authority without the exact authenticated endpoint origin and role. |
| POPUP-RTC-008 | Preparing and consuming `__libid_popup=rtc1.<round>.<had-fragment>` round-trips targets with no fragment, an empty fragment, ordinary fields, duplicate fields, preserved field order, mixed percent-escape spelling, encoded separators, and trailing separators without changing one caller byte. A caller-owned raw `__libid_popup` component rejects before navigation; invalid destination metadata clears the fragment and rejects before carrier selection. |

## Browser qualification

Real-device gates; the Playwright projects are emulation only and do not
satisfy these rows.

| ID | Assertion |
|---|---|
| POPUP-BROWSER-001 | Chromium, Gecko, and WebKit qualification covers Android, iOS, Linux, macOS, and Windows, including foreground popup work while the application tab is hidden or suspended. |
| POPUP-BROWSER-002 | Real-device qualification covers popup blocking, native-anchor fallback, browser promotion between popup and tab, background suspension, process eviction, and isolation severing the opener. Emulator-only results do not satisfy the corresponding real-device gate. |

## Diagnostics

| ID | Assertion |
|---|---|
| POPUP-DIAGNOSTIC-001 | Every emitted diagnostic contains only its stable package code, monotonic-derived timestamp, and any code-defined finite nonnegative duration or count; privacy-forbidden values and raw exceptions never reach the callback or console. |
| POPUP-DIAGNOSTIC-002 | A rejecting caller operation reports through rejection and the optional callback. An otherwise undeliverable asynchronous failure emits one sanitized `console.error` and optional callback event without network reporting, durable storage, retry, or caller result. Callback or console failure is inert. |
| POPUP-DIAGNOSTIC-003 | `fallback-unavailable` is absent when MessagePort succeeds and emitted exactly once only when fallback is selected without a constructor. An early supplied-constructor rejection remains observed and silent unless its path is selected. |
