# CCDP documents

The browser-facing entrypoints share one directory and import their execution logic
from the top-level ceremony modules.

- [Document contract](docs/documents.md): routes, fragments and origin policy.
- [Protocol phases](../docs/protocol.md#phases): readiness, navigation and delivery ordering.
- [Distribution policy](../../../build/docs/distribution.md): emitted resources and isolation headers.
- [Bridge callback shell](../../../docs/oauth-bridge.md#callback-document): capture and clear the OAuth return.

[callback.ts](callback.ts) authenticates the Application and privately forwards the
return. [prefetch.ts](prefetch.ts) is the dual-context Prefetch/Worker entrypoint and
imports the [cache implementation](../../prefetch/README.md). [prover.ts](prover.ts)
handles readiness, UI, cancellation and delivery while dispatching the
[platform pipelines](../../platforms/README.md). Proving machinery stays in
[prover/](../../prover/README.md).
