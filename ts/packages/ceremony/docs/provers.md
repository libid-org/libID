# Platform provers

Each platform/version owns authorization URLs, accepted OAuth returns, proof and
identity validators, resource declarations, events and its prover.
Shared Client, message and progress code consult that metadata instead of branching
on provider names. The [normative profiles](https://github.com/libid-org/libid/blob/main/specs/platform-ceremonies.md)
own authorization encodings and proof statements.

## Shared execution boundary

The Prover document dispatches a lazy prover with
[ProverContext](../src/platforms/context.ts): the validated request, authenticated
ceremony ID, private OAuth capture, abort signal and event producer. The prover
returns separate identity/proof values, or null for valid OAuth denial. Technical
failures throw with operation context. Platform code has no popup connection.
`ProverDocument` owns readiness, one-shot request execution, delivery and cleanup.
When proving starts, it transfers its private capture to the selected prover.

Validate the return, state and required inputs before credential use. Each
`url.ts` declares its return profile (transport, credential field, rejected
fields, issuer); [one parser](../src/platforms/oauthReturn.ts) decodes every value
once, bounds decoded values, and ignores provider metadata it does not need while
rejecting malformed encoding, duplicate fields, extra credentials, mixed outcomes
and wrong transport. GitHub also requires its exact issuer on success and error
returns; X does not inherit that requirement.

Client forwards `notaryAddress` uniformly; Google ignores it, X/GitHub require it.
The URL definition declares PKCE use; Client derives `codeVerifier` or sends null.
Every prover starts with [acceptReturn](../src/platforms/oauthReturn.ts), which
checks the request against the catalog's client ID, PKCE and credential
declarations, consumes the ceremony-bound return, and yields null for denial.
The notary address selects the service; platform/version metadata selects assets.

## Google

[google/1/token.ts](../src/platforms/google/1/token.ts) parses the ID token once,
accepts it only for the frozen client before its signed expiry, and selects the
JWK matching its `kid`. [witness.ts](../src/platforms/google/1/witness.ts)
adapts that token/key to the released `oidc_google` circuit encoder and assembles
the identity and proof fields. JWT/JWK input preparation overlaps [proof-worker startup](proving.md#worker-lifecycle).
Google creates no TLSNotary session.

The signed nonce is parsed canonically as the candidate authorization digest;
there is no separately supplied expected digest or browser signature-verification
step. The circuit checks the signed claims and binding. Downstream verification
must use the recomputed operation digest and trusted Google signing key.
JSON uses native parsing; authoritative field uniqueness is the provider guarantee
in ASM-PROV-06. Circuit inputs still reference the original signed bytes.
Delivery includes the proof, its 56 public inputs, expiry and modulus, beside the
exact signed audience, subject and email as identity fields. Prover compares the
backend's public inputs to its witness-derived values. Client then independently
rebuilds them with its retained authorization digest and the validated result,
rejecting any mismatch before announcing completion. These comparisons do not
verify the proof or establish trust in the signing key; the ledger remains authoritative.

## X and GitHub

[X](../src/platforms/x/1/prover.ts) and [GitHub](../src/platforms/github/1/prover.ts)
validate their returns and supply transcript profiles to
[the shared bearer-link prover](../src/platforms/bearer.ts). It overlaps:

1. Start the [bearer circuit prover](../src/barretenberg/circuits/bearer_link/prover.ts)
   and prepare token/identity sessions in one
   ceremony-owned notary runtime. Each TLS session has its own channel.
2. Send the token request and parse its bearer. Start token reveal/finalization;
   the prepared identity session can immediately send its request with the bearer.
3. Parse identity and reveal its selected transcript ranges. Once both sets of
   private openings are available, pass them to the circuit prover while final
   attestations continue. It builds the witness and checks the returned public inputs.
4. Join the proof and both correlated final attestations before returning.

Only identity HTTP depends on the token. Session setup and proof initialization
do not. Every provisional branch is observed immediately so a failure aborts
siblings rather than leaving work or a promise rejection behind.

GitHub's [token request](../src/platforms/github/1/transcript.ts) includes the
public application credential frozen from Bridge configuration and forwarded in
`ProveIdentity`. The complete request is revealed; the response bearer and both
commitment openings remain private. Both platforms exchange the code through
browser TLSNotary Proxy sessions, without a Bridge token endpoint or ordinary
browser HTTP exchange. The [public-client profile](https://github.com/libid-org/libid/blob/5e0e1f690369a7e4c5b61634342ae7fdb975795e/specs/platform-ceremonies.md)
owns GitHub's request layout; deployed verifiers must accept it.

X and GitHub share the `bearer_link` circuit and
[transcript machinery](../src/platforms/bearer-transcript.ts).
Each platform's `profile.ts` owns endpoints, request fields, identity headers and
user-name grammar; `transcript.ts` supplies its transcript selectors.
[bearer-types.ts](../src/platforms/bearer-types.ts) supplies the shared
client ID, identity and proof validators under each platform's names. The shared
machinery validates the common token inputs (form client ID, code, redirect URI,
PKCE verifier) and the circuit-width bearer once for both. Delivery
includes proof and both attestations; the shared identity is a convenience view, not an additional circuit output.

## Adding a platform

For another version-one platform:

1. Add `platforms/<id>/1/` with `url.ts` (including PKCE choice and return
   profile), `types.ts` (client ID, identity and proof validation, plus a
   `proofExpiresAt` adapter), event definitions
   (core operations and separate UI weights), `<id>.assets.ts` and `prover.ts`;
   X/GitHub share `bearer.events.ts` and `bearer.assets.ts` instead. Reuse shared parsers,
   notary sessions and circuit adapters only where their contracts fit. Keep
   platform-specific selectors and fixtures beside their tests.
2. Register its lightweight definition in [the catalog](../src/platforms/index.ts).
   It derives discovery, supported versions and result types.
3. Add the lazy import to [the platform provers](../src/platforms/provers.ts)
   and resource set to [the asset catalog](../src/platforms/platforms.assets.ts).
   Both are typed against the platform catalog: `typecheck` fails on a catalog
   version without a prover or resource set, and on either outside
   the catalog. The asset catalog derives its capacity-checked circuit list from those resource sets.
   Emitted JavaScript dependencies come from the compiler graph; do not copy
   those URLs into the resource set.
4. Set `requiresClientCredential` in the catalog when token exchange needs one.
   Configure the platform's OAuth registration in the Bridge and its presentation
   in the [dev app](../../../apps/dev/README.md). The Distribution publishes
   versions; Bridge configuration names the client used by every version.
5. Add canonical vectors, malformed-return/input cases, selected-asset/native-loader
   checks, actual-popup browser flows and released-key-verified real proofs.
   Map applicable [stable test IDs](test-plan.md) in [traceability](traceability.md).
   Complete authenticated-service/device qualification before claiming support.

For another version of an existing platform, add its leaf and the same catalog,
prover and asset registrations. Type checking enforces table coverage; the build
checks that the emitted prover chunks and asset profiles match the published
catalog. Client and Prefetch remain free of execution imports.

Only v1 return profiles exist today: `acceptReturn` reads the platform's v1 entry.
A version with different OAuth return rules also needs version-aware validation
in that helper; adding a registry entry alone does not change those rules.
