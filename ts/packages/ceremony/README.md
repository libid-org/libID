# @libid/ceremony

Browser identity ceremonies over a caller-supplied `@libid/popup` connection.

- [Package guide](docs/overview.md): application usage, package layout, build and checks.
- [Architecture](docs/architecture.md): ownership, public boundaries and versioning.
- [Source guide](docs/source.md): implementation map.
- [CCDP client](docs/client.md): configuration, construction, results and lifecycle.
- [CCDP](docs/protocol.md): messages, ordering and terminal outcomes.
- [Documents](docs/documents.md): Callback, Prefetch and Prover entrypoints and navigation.
- [Platform pipelines](docs/pipelines.md): Google, X and GitHub execution.
- [Proving](docs/proving.md): proof workers, toolchain and dependency loaders.
- [Notarization](docs/notarization.md): TLSNotary sessions and attestation contracts.
- [Assets](docs/prefetch.md): root Service Worker, byte caching and pending requests.
- [Distribution](docs/distribution.md): static artifacts, routes and response policies.
- [Build](docs/build.md): compiler and deployment tooling.
- [OAuth Bridge](docs/oauth-bridge.md): external server contract.
- [Metrics](docs/metrics.md): measurement contract; completeness is deferred.
- [Shared development app](../../apps/dev/README.md): frontend startup and real Bridge integration.
- [Browser tests](docs/browser-tests.md): HTTPS harness and proving qualification.
- [Test requirements](docs/test-plan.md), [traceability](docs/traceability.md), and
  [qualification](docs/qualification.md): required coverage, evidence and remaining gaps.

The architecture contracts originate in PR #13 at
`0259e72c184e2be7b78a0ad92188e8722d8d6daf`, reorganized here with implementation
guides. Transcript layouts, headers and JSON whitespace follow spec PR #31 at
`860075a4bf288dc7fee20866ed3536dc260f4574`. Requirement IDs are unchanged.
[Qualification](docs/qualification.md) records implementation deviations and remaining
live qualification gaps.
