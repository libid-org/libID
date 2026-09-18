# @libid/ceremony

Browser identity ceremonies for Google, X and GitHub over a caller-supplied
`@libid/popup` connection. The application owns popup lifetime, ledger operations
and submission; ceremony owns OAuth orchestration, proving and popup UI.

An accepted result has passed structural checks. The ledger verifier remains
authoritative for proof and attestation validity. **Release qualification is
incomplete**; see [evidence and remaining gates](docs/qualification.md).

## Use and develop

- [Client guide](docs/client.md): launch, platform/version discovery, results,
  events, errors and closure.
- [Shared development app](../../apps/dev/README.md): `pnpm -C ts dev` starts the
  frontend, Bridge, notary and CCDP for manual OAuth testing.
- [Build and deployment](docs/distribution.md): artifact commands, resource
  declarations, headers, compression and compatible updates.
- [Testing](docs/testing.md): unit, distribution, browser and manual checks.

## Maintain

- [Architecture](docs/architecture.md): module map, document lifecycle and boundaries.
- [Platform pipelines](docs/pipelines.md): concurrency and adding a platform/version.
- [Proving](docs/proving.md): Noir/Barretenberg integration and dependency upgrades.
- [Notarization](docs/notarization.md): session lifecycle and evidence handling.
- [Assets](docs/assets.md): prefetch, Service Worker ownership and caches.
- [Measurements](docs/metrics.md): event accounting and telemetry boundaries.
- [Requirement index](docs/test-plan.md) and [traceability](docs/traceability.md):
  stable test IDs, existing coverage and outstanding properties.

## Specifications

The [CCDP](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md),
[Bridge](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/oauth-bridge.md),
[Distribution](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp-distribution.md),
and [platform](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/platform-ceremonies.md)
specifications own interoperability and proof semantics. Package docs explain
this implementation.
