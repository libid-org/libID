# Platform provers

Each platform/version owns authorization URLs, accepted OAuth returns, proof and
identity validators, resource declarations, events and its prover.
Shared Client, message and progress code consult that metadata instead of branching
on provider names. The [normative profiles](https://github.com/libid-org/libid/blob/49ad6653c11e9f1fe2f0680d1f70754aefb9878f/specs/platform-ceremonies.md)
own authorization encodings and proof statements.

## Shared execution boundary

The Prover document dispatches a lazy prover with
[ProverContext](../src/platforms/context.ts): the validated request, the admitted
OAuth credential, the code verifier where the version declares PKCE, abort signal
and event producer. The prover returns separate identity/proof values. Technical
failures throw with operation context. Platform code has no popup connection.
`ProverDocument` owns readiness, one-shot request execution, OAuth return
admission, denial, delivery and cleanup. Its private capture never reaches a
prover.

Validate the return, state and required inputs before credential use. Each
`url.ts` declares its return rules (transport, credential field, rejected
fields, issuer); [one parser](../src/platforms/oauthReturn.ts) decodes every value
once, bounds decoded values, and ignores provider metadata it does not need while
rejecting malformed encoding, duplicate fields, extra credentials, mixed outcomes
and wrong transport. GitHub also requires its exact issuer on success and error
returns; X does not inherit that requirement.

Client forwards `notaryAddress` uniformly; Google ignores it, X/GitHub require it.
The URL definition declares PKCE use; Client derives `codeVerifier` or sends null.
Before loading the prover, `ProverDocument` calls
[acceptReturn](../src/platforms/oauthReturn.ts), which checks the request against
the catalog's client ID, PKCE and credential declarations and consumes the
ceremony-bound return. A denial sends `UserDenied` without loading a prover.
The notary address selects the service; platform/version metadata selects assets.

## Google

[google/1/token.ts](../src/platforms/google/1/token.ts) parses the ID token once,
accepts it only for the frozen client before its signed expiry, and selects the
JWK matching its `kid`. [inputs.ts](../src/platforms/google/1/inputs.ts)
adapts that token/key to the released `oidc_google` circuit inputs and assembles
the identity and proof fields. JWT/JWK input preparation overlaps [proof-worker startup](proving.md#worker-lifecycle).
Google creates no TLSNotary session.

The signed nonce is parsed canonically as the candidate authorization digest;
there is no separately supplied expected digest or browser signature-verification
step. The circuit checks the signed claims and binding. Downstream verification
must use the recomputed operation digest and trusted Google signing key.
JSON uses native parsing; authoritative field uniqueness is the provider guarantee
in ASM-PROV-06. Circuit inputs still reference the original signed bytes.
Delivery includes the proof, its 57 public inputs, expiry and modulus, beside the
exact signed audience and email and the REQ-PLAT-05A digest of the signed subject
as identity fields. Prover compares the
backend's public inputs to the values it derived for the circuit inputs. Client then independently
rebuilds them with its retained authorization digest and the validated result,
rejecting any mismatch before announcing completion. These comparisons do not
verify the proof or establish trust in the signing key; the ledger remains authoritative.

## X and GitHub

[X](../src/platforms/x/1/prover.ts) and [GitHub](../src/platforms/github/1/prover.ts)
validate their returns and supply their transcripts to
[the shared bearer-link prover](../src/barretenberg/circuits/bearer-link/prover.ts). It overlaps:

1. Start the [bearer-link circuit](../src/barretenberg/circuits/bearer-link/circuit.ts)
   and prepare token/identity sessions in one
   ceremony-owned notary runtime. Each TLS session has its own channel.
2. Send the token request and parse its bearer. Start token reveal/finalization;
   the prepared identity session can immediately send its request with the bearer.
3. Parse identity and reveal its selected transcript ranges. Once both sets of
   private openings are available, pass them to the bearer-link circuit while final
   attestations continue. It builds the circuit inputs and checks the returned public inputs.
4. Join the proof and both correlated final attestations before returning.

Only identity HTTP depends on the token. Session setup and proof initialization
do not. Every provisional branch is observed immediately so a failure aborts
siblings rather than leaving work or a promise rejection behind.

GitHub's [token request](../src/platforms/github/1/exchange.ts) includes the
public application credential frozen from Bridge configuration and forwarded in
`ProveIdentity`. The complete request is revealed; the response bearer and both
commitment openings remain private. Both platforms exchange the code through
browser TLSNotary Proxy sessions, without a Bridge token endpoint or ordinary
browser HTTP exchange. The [public-client profile](https://github.com/libid-org/libid/blob/49ad6653c11e9f1fe2f0680d1f70754aefb9878f/specs/platform-ceremonies.md)
owns GitHub's request layout; deployed verifiers must accept it.

X and GitHub share the `bearer_link` circuit and
[exchange machinery](../src/barretenberg/circuits/bearer-link/exchange.ts).
Each platform's `provider.ts` owns endpoints, request fields and identity headers, its
`validation.ts` the user-name grammar; `exchange.ts` supplies its requests and transcript selectors.
[bearer-link/validation.ts](../src/barretenberg/circuits/bearer-link/validation.ts) supplies the shared
client ID, identity and proof validators under each platform's names. The shared
machinery validates the common token inputs (form client ID, code, redirect URI,
PKCE verifier) and the circuit-width bearer once for both. Delivery
includes proof and both attestations; the shared identity is a convenience view, not an additional circuit output.

## Adding a platform

For another version-one platform:

1. Add `platforms/<id>/1/` with `provider.ts` (endpoints and request
   layout), `url.ts` (including PKCE choice and return rules), `validation.ts`
   (client ID, identity and proof validation, plus a `proofExpiresAt` adapter),
   `events.ts` (core events and separate UI weights), `<id>.assets.ts`
   and `prover.ts`;
   X/GitHub share `barretenberg/circuits/bearer-link/` instead. Reuse shared parsers,
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

`acceptReturn` checks each request against its own version's return rules, so a
version with different OAuth return rules declares them in its own `url.ts`.
