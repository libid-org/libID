# @libid/ceremony

Browser identity ceremonies over a caller-supplied `@libid/popup` connection.

- [Package guide](docs/overview.md): application usage, package layout, build and checks.
- [Architecture](docs/architecture.md): ownership, public boundaries and versioning.
- [Source guide](docs/source.md): implementation map.
- [CCDP client](docs/client.md): configuration, construction, results and lifecycle.
- [CCDP implementation](docs/protocol.md): message companions and state handling.
- [Documents](docs/documents.md): browser entrypoints and UI.
- [Platform pipelines](docs/pipelines.md): Google, X and GitHub execution.
- [Proving](docs/proving.md): proof workers, toolchain and dependency loaders.
- [Notarization](docs/notarization.md): TLSNotary sessions and attestation contracts.
- [Assets](docs/prefetch.md): root Service Worker, byte caching and pending requests.
- [Distribution](docs/distribution.md): resource declarations and static artifact build.
- [Build](docs/build.md): compiler and deployment tooling.
- [OAuth Bridge integration](docs/oauth-bridge.md): current server pins and the deferred path migration.
- [Metrics](docs/metrics.md): measurement contract; completeness is deferred.
- [Shared development app](../../apps/dev/README.md): frontend startup and real Bridge integration.
- [Browser tests](docs/browser-tests.md): HTTPS harness and proving qualification.
- [Test requirements](docs/test-plan.md), [traceability](docs/traceability.md), and
  [qualification](docs/qualification.md): required coverage, evidence and remaining gaps.

Normative contracts live in spec PR #13:
[CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md),
[OAuth Bridge](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/oauth-bridge.md), and
[Distribution](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md).
These package guides describe implementation rather than duplicating those rules.
[Qualification](docs/qualification.md) distinguishes tested behavior, pending
contract updates, and live/browser-device gaps. Existing test IDs are preserved.
