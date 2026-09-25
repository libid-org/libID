# Noir and Barretenberg proving

[src/barretenberg](../src/barretenberg/) owns the dedicated proof worker and
circuit adapters. [Platform pipelines](pipelines.md) prepare inputs and compose
it with notarization; the Prover page owns the browser connection and delivery.
The engine has no popup, ledger or transaction-submission dependency.

## Worker lifecycle

[ProofEngine](../src/barretenberg/engine.ts) boots once, accepts one input map,
returns one proof and destroys its worker. Platform owners call `destroy()` in
`finally` to cover abandoned or failed work. AbortSignals retire pending work;
late initialization cannot resurrect a settled engine.

[engine.worker.ts](../src/barretenberg/engine.worker.ts) starts three independent
branches together: circuit/released-key loading, explicit ACVM/ABI WASM loading,
and Barretenberg initialization. Noir/input readiness permits witness execution
while bb continues preparing. Proof generation joins witness and backend readiness.
`zk-proof-preparation` therefore may overlap `zk-proof-generation`; these events
are not exclusive timing stages.

The worker requires isolation, shared memory and at least two effective proof
threads. The request is capped at four and available hardware concurrency;
requesting threads alone is insufficient. There is no unisolated or silently
single-threaded proving path.

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
| [oidc_google](../src/barretenberg/circuits/oidc_google/) | Google's JWT witness and named semantic public inputs. |
| [bearer_link](../src/barretenberg/circuits/bearer_link/) | One private bearer opening token and identity commitments, shared by X/GitHub. |

The circuit repository owns the relation and ABI. Owner asset declarations pin
compiled circuits and their keys together; input modules and adjacent vectors
encode that ABI. They do not define a second proof format. Google result values
are semantic fields; X/GitHub verifier inputs come from signed attestations.
The package's private Google public-input helper supports fixture verification,
not application-side proof verification.

## Dependency asset resolution

[barretenberg.assets.ts](../src/barretenberg/barretenberg.assets.ts) is the single
source for ACVM/ABI WASM, bb WASM and native CRS requests. Circuit and notary
assets compose independently. Prefetch and execution resolve the same handles.

ACVM and ABI receive explicit absolute WASM URLs; bundled worker `import.meta.url`
cannot safely infer their original sibling paths. Noir reuses those initialized
module instances. The build emits decoded bb WASM and removes unused embedded
WASM copies through the compiler plugin. HTTP compression belongs to SWS.

**The pinned bb.js browser CRS loader ignores `crsPath` as a URL override.**
The engine supplies the declared primary base, but actual native requests still
use Aztec's primary/fallback URLs. CRS stays external; changing declarations to
local resources alone would break prefetch/execution agreement. There is no
fetch interception patch hiding that limitation.

Exact URL/range/fallback declarations live beside the dependency pin, not in a
second Markdown request table. `SRS_SIZE` and its browser-loader floor rationale
are documented there. [Capacity checks](../build/circuits.ts) inspect the released
circuits without downloading CRS; negative real-proof capacity qualification
remains a separate gate.

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
