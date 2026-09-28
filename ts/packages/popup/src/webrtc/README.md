# WebRTC carrier

See the [WebRTC carrier architecture and specification](../../docs/webrtc.md).

Suggested implementation shape:

```text
index.ts      WebRTC carrier construction and peer lifecycle.
signaling.ts  Bounded signaling rounds and navigation rearm.
codec.ts      Data-channel framing and value encoding.
```

This split is non-normative; change it if implementation reveals a cleaner
boundary.
