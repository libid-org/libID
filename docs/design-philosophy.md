# Design philosophy

These principles guide the protocols and software behind
[libID](../README.md).

## Small, composable primitives

The library provides loosely coupled, well-specified protocols with
accessible, API-first implementations. Each component has a clear job and
can be composed with application-owned behavior. For example, the
[popup primitive](../ts/packages/popup/README.md) supports protocols beyond
libID's identity flows.

## Specifications before implementations

The [protocol specifications](../specs/libid.md) define interoperability,
trust assumptions, and security properties. Package documentation explains
how to use and operate an implementation. Keeping those responsibilities
clear allows implementations to evolve against a shared contract.

## Local-first execution, accessible to users

Use the user's device for work it can perform locally, including generating
identity proofs. Each user contributes compute, and browser delivery makes
these flows accessible without installing an extension or separate
application. Platform authorization and services such as TLS notaries remain
part of the protocol where required.

## Explicit trust boundaries

Make clear what a component authenticates and what its callers must verify.
Browser origin isolation protects each site's state; an authenticated
channel identifies the peer origin; a ledger verifier decides whether
identity evidence is valid. Applications compose these guarantees with the
trust assumptions documented for each protocol.

## Open and self-hostable

Application developers, wallet providers, and other integrators should be
able to reuse components and operate their own deployments. Public
specifications and deployment tooling support that independence while
keeping the protocols interoperable.
