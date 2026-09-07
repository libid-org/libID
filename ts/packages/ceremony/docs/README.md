# Ceremony documentation

Start with the [package guide](../README.md) and [architecture](architecture.md).
Package-wide contracts live here; module contracts live beside their implementations.
Each directory README links to the relevant contract.

| Area | Guide and contract |
|---|---|
| Application API | [Client](../src/client/README.md) · [client contract](../src/client/docs/client.md) |
| Cross-document protocol | [CCDP](../src/ccdp/README.md) · [messages and ordering](../src/ccdp/docs/protocol.md) |
| Popup documents | [Entrypoints](../src/ccdp/documents/README.md) · [routes and navigation](../src/ccdp/documents/docs/documents.md) |
| Platform implementations | [Platforms](../src/platforms/README.md) · [proof pipelines](../src/platforms/docs/pipelines.md) |
| Proving | [Proof engine](../src/prover/README.md) · [proving contract](../src/prover/docs/proving.md) |
| Notarization | [TLSNotary adapter](../src/prover/notarization/README.md) · [notarization contract](../src/prover/notarization/docs/notarization.md) |
| Prefetch | [Worker and cache](../src/prefetch/README.md) · [cache lifecycle](../src/prefetch/docs/prefetch.md) |
| Static distribution | [Build](../build/README.md) · [distribution contract](distribution.md) |
| OAuth Bridge | [External server contract](oauth-bridge.md) |
| Metrics | [Measurement contract](metrics.md); completeness is deferred |
| Verification | [Test requirements](test-plan.md) · [traceability](traceability.md) · [qualification and blockers](qualification.md) |

These contracts originate in architecture PR #13 at
`109371854a303ac2e8449d1a1c63163285cbd6a6`. Sections were moved into their owning
modules, with cross-links and the package map updated. Requirement IDs are unchanged.
[Qualification](qualification.md) records implementation deviations and unresolved
normative amendments; organizing the documents does not resolve those differences.
