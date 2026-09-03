# Popup connection

See the [popup connection architecture and specification](../../docs/connection.md)
and [popup control specification](../../docs/control.md).

Suggested implementation shape:

```text
index.ts       Internal module boundary.
connection.ts  Logical connection, carrier selection, and lifecycle.
```

This split is non-normative; change it if implementation reveals a cleaner
boundary.
