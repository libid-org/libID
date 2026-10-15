# @libid/ceremony

[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Flibid-org%2FlibID%2Fbadges%2Fceremony-coverage.json)](docs/testing.md)

Turn control of a social account into portable evidence a ledger can verify.

An identity ceremony lets a user authorize an application operation through
an account they already have. It is the proving step behind using social
identities in payments, wallets, and other applications.

**Current integrations:** Google, X, and GitHub, with EVM-compatible chains
as the initial ledger targets. **Release qualification is incomplete**; see
[evidence and remaining gates](docs/qualification.md).

## How it works

1. The user authorizes the operation through the platform's OAuth flow.
2. Their browser generates a zero-knowledge proof using a signed identity
   token or notarized TLS evidence, depending on the platform.
3. The application receives the result and submits it to the destination
   ledger, whose verifier checks the proof and any attestations.

Users need no browser extension or separate application. The package handles
the OAuth flow, proving, and popup UI; the application owns the popup's
lifetime, wallet interactions, and transaction submission. An `accepted`
result has passed structural checks; final cryptographic verification
belongs to the ledger.

The outcome resembles the Fiat-Shamir transformation: an interactive
exchange yields evidence that others can verify independently. OAuth still
runs interactively; libID combines zero-knowledge proofs with platform-signed
identity tokens or notarized TLS transcripts to make the result verifiable
without another interaction with the platform.

Google, X, and GitHub cover different OAuth/OIDC models: Google's ceremony
uses a signed identity token, while X and GitHub use notarized token and
account responses. Their respective
[ceremony profiles](../../../specs/platform-ceremonies.md) describe the
evidence and trust assumptions. Further platforms need their own profiles
and proving artifacts.

## Use and develop

**Distribution:** the npm package contains the application client and requires
`@libid/popup` as a peer. Proving runs in the separately deployed CCDP container
(see [Build and deployment](docs/distribution.md)).
See [npm releases](../../RELEASING.md) for packaging and publication.

- [Client guide](docs/client.md): launch, platform/version discovery, results,
  events, errors and closure.
- [Shared development app](../../apps/dev/README.md): `pnpm -C ts dev` starts the
  frontend, Bridge, notary and CCDP for manual OAuth testing.
- [Build and deployment](docs/distribution.md): artifact commands, resource
  declarations, headers, compression and compatible updates.
- [Testing](docs/testing.md): unit, distribution, browser and manual checks.

## Maintain

- [Architecture](docs/architecture.md): module map, document lifecycle and boundaries.
- [Platform provers](docs/provers.md): concurrency and adding a platform/version.
- [Proving](docs/proving.md): Noir/Barretenberg integration and dependency upgrades.
- [Notarization](docs/notarization.md): session lifecycle and evidence handling.
- [Assets](docs/assets.md): prefetch, Service Worker ownership and caches.
- [Measurements](docs/metrics.md): event accounting and telemetry boundaries.
- [Requirement index](docs/test-plan.md) and [traceability](docs/traceability.md):
  stable test IDs, existing coverage and outstanding properties.

## Specifications

The [CCDP](https://github.com/libid-org/libid/blob/66096eb1d31ea7007c2749ab1e26d15da5714f4d/specs/ccdp.md),
[Bridge](https://github.com/libid-org/libid/blob/66096eb1d31ea7007c2749ab1e26d15da5714f4d/specs/oauth-bridge.md),
[Distribution](https://github.com/libid-org/libid/blob/66096eb1d31ea7007c2749ab1e26d15da5714f4d/specs/ccdp-distribution.md),
and [platform](https://github.com/libid-org/libid/blob/66096eb1d31ea7007c2749ab1e26d15da5714f4d/specs/platform-ceremonies.md)
specifications own interoperability and proof semantics. Package docs explain
this implementation.
