# Noir and Barretenberg proving

[src/barretenberg](../src/barretenberg/) owns the dedicated proof worker and
circuit adapters. [Platform provers](provers.md) prepare inputs and compose
it with notarization; the Prover page owns the browser connection and delivery.
The engine has no popup, ledger or transaction-submission dependency.

## Worker lifecycle

[ProofEngine](../src/barretenberg/engine.ts) boots once, accepts one input map,
returns one proof and destroys its worker. Platform owners call `destroy()` in
`finally` to cover abandoned or failed work. AbortSignals retire pending work;
late initialization cannot resurrect a settled engine.

[BearerLinkCircuit](../src/barretenberg/circuits/bearer-link/circuit.ts) owns the
bearer circuit/key selection, circuit input preparation and public-input check. Its
constructor starts the engine before token exchange; `prove()` consumes the
selected private openings and returns proof bytes. The shared platform flow
joins those bytes with both final attestations and destroys the prover in `finally`.

[engine.worker.ts](../src/barretenberg/engine.worker.ts) starts three independent
branches together: circuit/released-key loading, explicit ACVM/ABI WASM loading,
and Barretenberg initialization. Noir/input readiness permits witness execution
while bb continues preparing. Proof generation joins witness and backend readiness.
`zk-proof-preparation` therefore may overlap `zk-proof-generation`; these events
are not exclusive timing stages.

The worker requires isolation and shared memory. It caps the requested proof
threads at four and its own hardware concurrency, then requires at least two
before starting bb.js. Missing hardware concurrency counts as one.

The engine supplies each circuit's matching released verification key to
`circuitProve`, avoiding local key generation. Missing or empty keys fail.
The settings explicitly match bb.js's `verifierTarget: 'evm'` ZK-Honk/Keccak mode.
This is the released circuit's proof format, not a blockchain adapter or a
runtime choice based on ledger identity. Browser code does not verify final
proofs; [the Node harness](../e2e/verify.ts) verifies browser-generated proofs
against released keys and rejects altered public inputs.

## Circuits

| Owner | Use |
|---|---|
| [oidc_google](../src/barretenberg/circuits/oidc_google/) | The released Google OIDC circuit's ABI encoding; the Google platform owns JWT extraction, identity and semantic public inputs. |
| [bearer_link](../src/barretenberg/circuits/bearer-link/) | One private bearer opening token and identity commitments, shared by X/GitHub. |

The circuit repository owns the relation and ABI. Owner asset declarations pin
compiled circuits and their keys together. Each circuit’s `parameters.ts` owns
its fixed dimensions; input modules and independent vectors encode that ABI. They
do not define a second proof format. Google result values are semantic fields;
X/GitHub verifier inputs come from signed attestations.
The private Google public-input helper also rebuilds the expected fields during
Client acceptance. This checks result binding, not cryptographic proof validity.

## Dependency asset resolution

[barretenberg.assets.ts](../src/barretenberg/barretenberg.assets.ts) is the single
source for ACVM/ABI WASM, bb WASM and native CRS requests. Circuit and notary
assets compose independently. Prefetch and execution resolve the same handles.

ACVM and ABI receive explicit absolute WASM URLs; bundled worker `import.meta.url`
cannot safely infer their original sibling paths. Noir reuses those initialized
module instances. The build emits decoded bb WASM and removes unused embedded
WASM copies through the compiler plugin. HTTP compression belongs to SWS.

**CRS requests go to Aztec's CDN.** The engine already passes the declared CRS
base as `crsPath`, but the pinned bb.js browser loaders ignore it until a pending
upstream patch lands, and request Aztec's primary and fallback URLs. So the CRS
is declared external at exactly those URLs and ranges, and Prefetch and execution
request the same bytes. Distributing the CRS needs that patched release, proven
by the loader probe before the declarations change.

Exact URL/range/fallback declarations live beside the dependency pin, the one
request table. [parameters.ts](../src/barretenberg/parameters.ts)
owns the shared proving settings, `SRS_POINTS` and browser-loader dimensions.
[Capacity checks](../build/circuits.ts) inspect the released circuits without
downloading CRS; negative real-proof capacity qualification remains a separate gate.

## Upgrade checklist

1. Change installed dependency pins, the corresponding asset mounts and matching
   circuit/key release together. Preserve previously published immutable URLs.
2. Run [native-loader tests](../build/loaders.test.ts). They execute the installed
   loaders and observe actual URLs, ranges, fallback, cache modes and explicit
   ACVM/ABI initialization. Comparing two copied request lists is insufficient.
3. Rebuild and check emitted scripts, nested workers, WASM policies and compression.
   Run the [browser suite](testing.md#browser-tests) from empty and warm caches,
   blocking unlisted external asset hosts. A successful typecheck cannot establish
   worker startup or dependency-loader compatibility.
4. Verify real browser-generated proofs against the matching released key. Repeat
   live CDN/isolation and matched-notary concurrency qualification where affected.
   Keep [remaining release gates](qualification.md#remaining-qualification) explicit.

Fine-grained engine events are declared in
[barretenberg/events.ts](../src/barretenberg/events.ts). They share the
[operation feed](metrics.md); they do not add a second progress protocol.
