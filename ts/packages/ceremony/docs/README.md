# Ceremony documentation

All package documentation lives in this directory.

- [Package guide](overview.md): application usage, package layout, build and checks.
- [Architecture](architecture.md): ownership, public boundaries and versioning.
- [Source guide](source.md): implementation map.
- [Client](client.md): configuration, construction, results and lifecycle.
- [CCDP](protocol.md): messages, ordering and terminal outcomes.
- [Documents](documents.md): Callback, Prefetch and Prover entrypoints and navigation.
- [Platform pipelines](pipelines.md): Google, X and GitHub execution.
- [Proving](proving.md): proof workers, toolchain and dependency loaders.
- [Notarization](notarization.md): TLSNotary sessions and attestation contracts.
- [Prefetch](prefetch.md): root Service Worker, byte caching and pending requests.
- [Distribution](distribution.md): static artifacts, routes and response policies.
- [Build](build.md): compiler and deployment tooling.
- [OAuth Bridge](oauth-bridge.md): external server contract.
- [Metrics](metrics.md): measurement contract; completeness is deferred.
- [Browser tests](browser-tests.md): HTTPS harness and proving qualification.
- [Test requirements](test-plan.md), [traceability](traceability.md), and
  [qualification](qualification.md): required coverage, evidence and remaining gaps.

The architecture contracts originate in PR #13 at
`412df215b93473f79fae75df602f6b0be42b13a9`, reorganized here with implementation
guides. Requirement IDs are unchanged. [Qualification](qualification.md) records
implementation deviations and remaining qualification gaps.
