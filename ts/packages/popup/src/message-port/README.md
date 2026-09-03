# MessagePort carrier

See the [MessagePort carrier architecture and specification](../../docs/message-port.md).

Suggested implementation shape:

```text
index.ts   MessagePort authentication and carrier adapter.
keeper.ts  Short-lived port preservation across navigation.
worker.ts  Service Worker entry point for port transfer.
```

This split is non-normative; change it if implementation reveals a cleaner
boundary.
