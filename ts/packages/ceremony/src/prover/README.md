# Proof execution

Owns the shared proof engine, worker runtime, input helpers and notarization adapter.
The browser page itself lives in [ccdp/documents/prover.ts](../ccdp/documents/prover.ts).

- [Proving contract](docs/proving.md): proof delivery, toolchain, loaders, progress and isolation.
- [Platform pipelines](../platforms/docs/pipelines.md): provider-specific execution order.
- [Notarization](notarization/README.md): TLSNotary sessions and canonical attestations.
- [Prefetch](../prefetch/README.md): byte caching before execution.

[engine.ts](engine.ts) controls [engine.worker.ts](engine.worker.ts); [bb/assets.ts](bb/assets.ts)
owns shared backend resources. [bearerLink.ts](bearerLink.ts) constructs the common
bearer-link witness. [progress.ts](progress.ts) accounts for completed work. The browser
performs no final cryptographic proof verification; qualification uses released keys
in a separate harness.
