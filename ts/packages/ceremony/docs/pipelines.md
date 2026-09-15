# Platform pipelines

Each platform/version owns authorization URLs, accepted OAuth returns, proof and
identity validators, resource declarations, events and its execution pipeline.
Shared Client, message and progress code consult that metadata instead of branching
on provider names. The [normative profiles](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/platform-ceremonies.md)
own authorization encodings and proof statements.

## Shared execution boundary

The Prover document dispatches a lazy pipeline with
[ProverContext](../src/platforms/context.ts): the validated request, authenticated
ceremony ID, private OAuth capture, abort signal and event producer. The pipeline
returns separate identity/proof values, or null for valid OAuth denial. Technical
failures throw with operation context. Platform code has no popup connection.

Validate the return, state and required inputs before credential use. OAuth
parsers ignore bounded provider metadata they do not need while rejecting
malformed encoding, duplicate fields, extra credentials, mixed outcomes and
wrong transport. GitHub also requires its exact issuer on success and error
returns; X does not inherit that requirement.

Client forwards `notaryAddress` uniformly; Google ignores it, X/GitHub require it.
The URL definition declares PKCE use; Client derives `codeVerifier` or sends null,
and the pipeline enforces its requirement. Neither input selects an asset or a
replacement notary. A second platform must not require another shared-code branch.

## Google

[google/1/prover.ts](../src/platforms/google/1/prover.ts) selects the JWK matching
the captured token's `kid` and builds the released `oidc_google` witness. JWT/JWK
input preparation overlaps [proof-worker startup](proving.md#worker-lifecycle).
Google creates no TLSNotary session.

The signed nonce is parsed canonically as the candidate authorization digest;
there is no separately supplied expected digest or browser signature-verification
step. The circuit checks the signed claims and binding. Downstream verification
must use the recomputed operation digest and trusted Google signing key.
Delivery includes the proof, expiry and modulus, beside the exact signed audience,
subject and email as identity fields.

## X

[x/1/prover.ts](../src/platforms/x/1/prover.ts) overlaps these dependencies:

1. Start the proof engine and prepare token/identity sessions in one
   ceremony-owned notary runtime. Each TLS session has its own channel.
2. Send the token request and parse its bearer. Start token reveal/finalization;
   the prepared identity session can immediately send its request with the bearer.
3. Parse identity and reveal its selected transcript ranges. Once both sets of
   private openings are available, build the `bearer_link` witness and prove
   while final attestations continue.
4. Join the proof and both correlated final attestations before returning.

Only identity HTTP depends on the token. Session setup and proof initialization
do not. Every provisional branch is observed immediately so a failure aborts
siblings rather than leaving work or a promise rejection behind.

## GitHub

[github/1/prover.ts](../src/platforms/github/1/prover.ts) uses the same browser
scheduling as X: two Proxy sessions in one notary runtime, with identity HTTP
waiting only for a usable bearer and its prepared session. `token-fetch` ends
before token attestation; proof generation can overlap both final attestations.
Any failure aborts sibling work and prevents delivery.

[The token request](../src/platforms/github/1/token.ts) contains five canonical
form fields in order: `client_id`, `code`, `redirect_uri`, `code_verifier`,
`client_secret`. The last is GitHub's public application credential, frozen from
Bridge configuration and forwarded unchanged in `ProveIdentity`. The complete
request is revealed; the response bearer and both commitment openings remain
private. There is no Bridge token endpoint call or ordinary browser HTTP exchange.
The [public-client profile](https://github.com/libid-org/libid/blob/5e0e1f690369a7e4c5b61634342ae7fdb975795e/specs/platform-ceremonies.md)
owns this request layout; deployed verifiers must accept that layout.

X and GitHub share the `bearer_link` circuit, but retain their own transcript
selectors and proof validators. Delivery includes proof and both attestations;
the shared identity is a convenience view, not an additional circuit output.

## Adding a platform

For another version-one platform:

1. Add `platforms/<id>/1/` with `url.ts` (including PKCE choice), `types.ts`
   (client ID, identity and proof validation), `events.ts` (core operations and
   separate UI weights), `<id>.assets.ts` and `prover.ts`. Reuse shared parsers,
   notary sessions and circuit adapters only where their contracts fit. Keep
   platform-specific selectors and fixtures beside their tests.
2. Register its lightweight definition in [the catalog](../src/platforms/index.ts).
   It derives discovery, supported versions and result types.
3. Add the lazy import to [the Prover dispatcher](../src/ccdp/documents/prover.ts)
   and resource set to [the asset catalog](../src/platforms/platforms.assets.ts).
   Both are checked against the platform catalog. Add any new circuit to the
   capacity list in the asset catalog. Emitted JavaScript dependencies come from
   the compiler graph; do not copy those URLs into the resource set.
4. Have Bridge advertise the implemented version and any required public
   token-exchange credential; set `requiresClientCredential` in the catalog.
   A future Bridge service needs an explicit platform-profile contract. Add
   configuration and presentation in the [dev app](../../../apps/dev/README.md).
5. Add canonical vectors, malformed-return/input cases, selected-asset/native-loader
   checks, actual-popup browser flows and released-key-verified real proofs.
   Map applicable [stable test IDs](test-plan.md) in [traceability](traceability.md).
   Complete authenticated-service/device qualification before claiming support.

These three registration points preserve Client/Prefetch import boundaries;
there is no mutable plugin registry. For a **second ceremony version**, also
extend the version-one-only Prover dispatcher and distribution runtime-entry
lookup. Client discovery alone does not implement another version.
