# Popup metrics and diagnostics

`@libid/popup` measures its own window, connection, carrier, continuity, and
control work. It never exports telemetry itself. A caller may supply
`onDiagnostic` to receive sanitized local events under its own observability
policy.

```ts
interface PopupDiagnostic {
  readonly code: string
  readonly timestamp: number
  readonly durationMs?: number
  readonly count?: number
}
```

`code` is a stable package-owned identifier. The public type stays `string`
because the catalog is open: each carrier adds its own codes, and a closed
union would break exhaustive consumers on every addition. Renaming or removing
a catalogued code is a breaking change. `timestamp` uses
`performance.timeOrigin + performance.now()`. Optional finite, nonnegative
`durationMs` and integer `count` fields are present only where their meaning is
fixed by the code. The callback receives no arbitrary details map, raw
exception, URL, origin, connection ID, message discriminator, or transported
value.

## Measurements

| Area | Measurements |
|---|---|
| Popup window | `window-opened`, `window-blocked`, `window-bound` |
| Connection | `handshake-rejected`, `carrier-message-port`, `carrier-restored`, `carrier-fallback`, `fallback-unavailable`, `popup-unavailable`, `send-unavailable`, `connection-closed` and `connection-failed` with `durationMs` since construction |
| Message delivery | `decode-rejected`; MessagePort adds no encoding or clock, so no size or latency measurement exists |
| Continuity | `keep-acknowledged` with `durationMs`, `keep-failed`, `claim-empty`, `continuity-unsupported` |
| Control | `control-direct`, `control-connected`, `control-rejected`; never remote success |
| WebRTC | signaling-path class, offer publication, answer pickup, candidate class, selected-pair class, ICE checks, DTLS, data-channel open, and terminal failure |

`fallback-unavailable` is emitted exactly once only when opener-based
connection has failed and no fallback constructor exists. Merely omitting the
constructor or successfully selecting MessagePort emits no fallback failure.
A supplied constructor which rejects retains its own stable failure code;
connection records it only if that fallback path is selected.

## Privacy and failure handling

Diagnostics never contain:

- popup or application origins, URLs, connection IDs, SDP, ICE addresses,
  cookies, or signaling records;
- caller message types, fields, payloads, proof material, credentials, or byte
  contents; or
- raw exceptions, stacks, caller-selected labels, or unbounded strings.

Candidate and selected-pair measurements use only package-defined classes.
Message sizes use bounded numeric buckets rather than contents. Any caller
export maps package codes to its own cardinality-controlled schema.

An operation that can reject reports failure through that rejection and the
optional callback. A caught asynchronous failure with no remaining caller
operation emits one sanitized `console.error` containing only the package
subsystem and stable code, then invokes `onDiagnostic` when present. Failure of
the callback or console path is inert. The package starts no reporting request,
writes no durable diagnostic record, retries nothing, and synthesizes no caller
result.
