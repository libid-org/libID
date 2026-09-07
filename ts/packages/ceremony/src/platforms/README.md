# Platform ceremonies

Each platform/version owns authorization, the proof shape, asset declarations and
its Prover pipeline. The catalog is closed and client-safe.

- [Platform pipelines](docs/pipelines.md): shared startup, circuit selection, Google, X and GitHub.
- [Versioning](../../docs/architecture.md#versioning-and-compatibility): ceremony compatibility.
- [Result contract](../client/docs/client.md#result-and-lifecycle): identity and OAuth proof assembly.
- [Normative platform profiles](../../../../../specs/platform-ceremonies.md): encodings and proof statements.

[index.ts](index.ts) derives the public types and dispatches structural validation.
[authorization.ts](authorization.ts) provides shared digest/PKCE helpers;
[assets.ts](assets.ts) aggregates data-only declarations.

| Platform | Client leaf | Prover leaf | Pipeline contract |
|---|---|---|---|
| Google v1 | [client](google/1/client.ts) | [prover](google/1/prover.ts) | [Google](docs/pipelines.md#google) |
| X v1 | [client](x/1/client.ts) | [prover](x/1/prover.ts) | [X](docs/pipelines.md#x) |
| GitHub v1 | [client](github/1/client.ts) | [prover](github/1/prover.ts) | [GitHub](docs/pipelines.md#github) |

Execution imports its asset declarations; declarations never import execution.
See the [qualification record](../../docs/qualification.md) before treating a pipeline
as a qualified real OAuth ceremony.
