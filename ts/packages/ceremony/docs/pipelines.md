# Platform proof pipelines

## Platform pipelines

### Shared startup

Prover imports its runtime concurrently with joining selected-profile asset
prefetch. Once both are ready and the OAuth return is accepted, platform input
preparation and dedicated proof-worker startup run concurrently. Backend
initialization needs only its code-owned WASM, CRS and thread settings; it does
not wait for the circuit or ceremony inputs. Witness execution needs prepared
inputs, the circuit and initialized ACVM/ABI; it can overlap backend initialization.

Inside the proof worker, start Barretenberg initialization, circuit/key loading,
and ACVM/ABI WASM initialization concurrently. Construct Noir and report readiness
for inputs after circuit/key and ACVM/ABI loading succeed. Generate the witness
while any remaining backend initialization continues; proof generation joins both.
A failed branch reports failure promptly; an initialized backend is destroyed,
including one that finishes after the failure. The owner terminates the proof
worker and its outstanding work on error or cancellation. Late completions cannot
revive a failed run or deliver a result.
Pass the build-emitted absolute same-origin WASM URLs explicitly to the
ACVM/ABI initializers. Do not let wasm-bindgen infer sibling paths from a
bundled or `blob:` worker's `import.meta.url`. Noir must reuse those initialized
module instances, not a second bundled copy that repeats default initialization.
Request up to four proof threads, capped by hardware concurrency. Check actual
worker isolation, shared-memory availability, and effective thread count; a
requested thread count is not evidence that multithreading started. Unsupported
execution fails explicitly rather than silently accepting single-threaded work.

That thread cap belongs to the proof engine, not to each TLSNotary session.
Notarization chooses and measures its own WASM/thread-pool configuration; two
concurrent sessions must not silently multiply a shared pool or inherit the
proof-worker thread count.

These overlaps change scheduling, not proof inputs, validation, or delivery
conditions. Failure or cancellation tears down outstanding sibling work and
discards any provisional result.

### Circuit selection

The platform-version prover leaves own witness construction and orchestration; the circuit
repository owns the exact proof relation and ABI. Launch uses these artifacts:

| Profile | Circuit | Returned attestations |
|---|---|---|
| `google` | [`oidc-google`](https://github.com/libid-org/libid-circuits/blob/91bc3446eeaa50ab2056d88dd9941374aa4fa34c/circuits/oidc-google/src/main.nr) | none |
| `x` | [`bearer-link`](https://github.com/libid-org/libid-circuits/blob/91bc3446eeaa50ab2056d88dd9941374aa4fa34c/circuits/bearer-link/src/main.nr) | token, identity |
| `github` | the same `bearer-link` artifact | token exchange, identity |

Those links pin the current launch source snapshot. Deployment consumes the
matching compiled Abstract Circuit Intermediate Representation (ACIR), circuit
ABI, and manifest from a
[`libid-circuits` release](https://github.com/libid-org/libid-circuits/releases),
not source or an application-selected URL. A profile is available when the
ceremony package and its matching circuit release are deployed. Whether a
chain-specific Ledger Verifier accepts the resulting `OAuthProof` is independent.

All pipelines use one proving engine. The platform module builds the closed
Noir input map, the Noir ACIR virtual machine (ACVM) runtime solves the witness,
and the circuit-compatible
[Aztec bb.js](https://github.com/AztecProtocol/aztec-packages/tree/v5.2.0/barretenberg/ts)
release generates an UltraHonk proof through `api.circuitProve`, supplying the
matching released `vk` instead of recomputing it. The circuit and key are
prefetched from the same release archive. Missing or empty keys fail; there is
no fallback to key generation. Native `DecompressionStream` decodes the
compressed ACIR and witness before the call.

The explicit settings are exactly bb.js 5.2.0's `verifierTarget: 'evm'` mapping:
`ipaAccumulation: false`, `oracleHashType: 'keccak'`, `disableZk: false`, and
`optimizedSolidityVerifier: false`. This preserves ZK-Honk with the Keccak
transcript. The settings belong to the pinned platform proving configuration;
they are not selected from the caller's chain. Qualification verifies the browser
output against the matching released verifier artifact and key, not just a
local verifier configured with the same possibly incorrect defaults.

bb.js returns raw proof bytes and an
ordered flat array of field-valued public inputs. Google delivers the proof and
its named semantic public values, not that flattened array. X and GitHub deliver
the proof but not the array because their Platform Verifiers reconstruct its two
semantic commitments from the submitted attestations. The browser does not
verify the generated proof or define a second circuit ABI.

X and GitHub additionally use the browser TLSNotary bundle built by the
[`libid-org/notary` build script](https://github.com/libid-org/notary/blob/e0ce1f1e0bedcde54740d1af70d4eaf9b439a9fb/scripts/build-tlsn-wasm.sh)
and published in [`libid-org/notary` releases](https://github.com/libid-org/notary/releases).
The browser distribution exposes `tlsn_wasm.js` and its sibling
`tlsn_wasm_bg.wasm`; the worker bootstrap is embedded in the module. The global
notarization module pins both immutable asset paths. Each remains a normal,
independently cached response; the browser never downloads or unpacks a release
archive. The [CCDP Distribution contract](distribution.md#proving-assets) owns their
serving.
Prover validates `AppStartProver.notaryAddress`, already
[selected by CCDPClient](client.md#notary-selection), and uses it
unchanged. It owns no notary profiles, ledger dependency, or override. All addresses use
the same proving resources and prefetch graph; Google receives null and makes
no notary request.

### Google

`platforms/google/1/prover` receives the captured ID Token and frozen client identifier.
It obtains the JSON Web Key (JWK) selected by the token's `kid` from Google's
JSON Web Key Set (JWKS) endpoint and constructs the `oidc_google` input map:

- private witness: JSON Web Token (JWT) signing input and payload bytes with
  their lengths, checked-claim offsets and lengths, raw email/`sub`/`aud` bytes,
  RSA signature, and the RSA reduction witness;
- public inputs, in circuit order: 32 authorization-digest bytes, two fields
  containing `SHA256(aud)`, one packed `sub` field, two packed email fields,
  `exp`, and eighteen RSA-modulus limbs.

JWT decoding, signing-key retrieval and selection, and circuit-input
construction overlap proof-worker startup and backend initialization. Witness
execution starts once inputs and Noir are ready, while bb may still be initializing.
No TLSNotary session is created for Google.

The semantic groups flatten to exactly 56 bb.js public-input fields. The module
requires a canonical unpadded base64url nonce encoding exactly 32 bytes and
uses those bytes as the candidate authorization digest. Neither Prover nor
Client compares that candidate to the Application's separately constructed
digest; `AppStartProver` carries no expected-digest field. The circuit
re-encodes the candidate as the exact nonce and verifies the RS256
signature and signed claims. The module then generates one proof and returns it
with the signed expiry and selected JWK modulus as `GoogleProofV1`, with no
attestation or flattened public-input array.
The Prover builds `identity` with `platformId: 'google'`, `oauthClientId` from
`aud`, `userId` from `sub`, and `userName` from `email`, without normalization.
The Ceremony Client checks result structure and wraps it; only Ledger Verifier
verification makes these fields authoritative. An otherwise valid token for
another digest can reach proof delivery, but its proof fails downstream
verification against the recomputed authorization digest. A valid circuit
proof under an untrusted signing modulus likewise fails the downstream trusted
Google signing-key check. Omitting early comparison changes when a mismatch is
detected, not either ledger verification requirement.

### X

`platforms/x/1/prover` performs two browser-owned TLSNotary Proxy sessions:

1. Connect and set up the token and identity TLSNotary sessions concurrently,
   while the proof backend initializes. Both use one ceremony-owned WASM runtime
   and thread pool; each session owns its own WebSocket, TLS prover and transcript.
2. Execute the fixed `/2/oauth2/token` exchange using the captured code,
   derived code verifier, frozen redirect URI, and client identifier. Reveal
   the profile-owned request and delimiter ranges and commit the returned
   bearer.
3. Parse the bearer from the token-response transcript as soon as it is
   available, without waiting for token reveal or attestation completion. Use
   it in the already-prepared identity session's fixed `/2/users/me` request.
   Reveal the complete
   request framing around its committed bearer plus the identity response's
   canonical `id` and `username` ranges.
4. Once both sessions expose the required reveal material and independent
   16-byte commitment openings, build the `bearer-link` witness from the private
   bearer, its length, and those blinders. Execute the witness as soon as Noir is
   ready; generate the proof once both witness and backend are ready, overlapping
   final notarization work.
5. Deliver `bearerLinkProof`, both final attestations with their decoded views,
   and the extracted `identity` only after commitment and transcript
   correlations pass. A late notarization failure discards an already-generated
   proof.

Only the identity HTTP request waits for the token-response bearer; session
setup and attestation completion are not that dependency. Early transcript and
opening material is provisional, not an authenticated attestation. The circuit constrains the bearer to
nonempty printable ASCII of at most 128 bytes and exposes exactly the two
32-byte bearer commitments, token first and identity second; Noir flattens them
to 64 bb.js public-input fields. `identity` uses `platformId: 'x'`, the attested
token-request client identifier, and the attested response's `id` and
`username`. These extracted fields are not extra circuit outputs. The Platform
Verifier derives authoritative identity and authorization binding from the
verified attestations and submitted authorization fields.

### GitHub

`platforms/github/1/prover` starts browser identity-session setup alongside the
fixed OAuth Bridge token-exchange request carrying the captured code, derived
verifier, and resolved `notaryAddress`. Proof-backend initialization overlaps both.
Setup uses the fixed GitHub target and needs no bearer; `/user` HTTP waits for
both setup and token-response admission. Failure in either branch cancels the
other; setup failure retains its notarization error instead of being reported as
a token-exchange failure.
The Bridge and browser identity session use that exact address supplied by the
ledger; the Bridge performs no network classification.
The bridge uses its confidential client secret, performs the token-exchange
TLSNotary session, and returns the bounded access token, token attestation,
and `bearerOpening`: the
canonical unpadded base64url encoding of the token session's exact 16-byte
TLSNotary blinder. The
browser exact-validates the selected version's token response, attestation
encoding and correlation, request bindings, and bearer opening before using
the bearer in its own fixed `/user` TLSNotary session. Neither Prover nor Client
verifies notary signatures locally; downstream verification remains mandatory.
A structurally valid forgery can survive these early checks and waste browser
work, but cannot pass ledger signature verification under the trusted notary
keys. That session commits the bearer and reveals the
canonical `id` and `login` ranges. The OAuth bridge route is defined in
[OAUTH_BRIDGE.md](oauth-bridge.md#github-token-endpoint).

The module then runs the same `bearer-link` circuit with the token-exchange and
identity blinders. Its public-input count and order are identical to X: 64
fields representing token commitment then identity commitment. Delivery
contains a `proof` with `bearerLinkProof` and the token-exchange and identity
attestations with their decoded views, beside `identity` with
`platformId: 'github'`, the attested token-request client identifier, and
`/user`'s `id` and `login`. The browser
decodes the server-returned token attestation itself; the bridge's JSON response
does not gain a `decoded` field. GitHub-specific server exchange and transcript
construction therefore remain platform code; no GitHub-specific proving
circuit or proving engine exists.

## Implementation guide

Each platform/version owns authorization, the proof shape, asset declarations and
its Prover pipeline. The catalog is closed and client-safe.

- [Versioning](architecture.md#versioning-and-compatibility): ceremony compatibility.
- [Result contract](client.md#result-and-lifecycle): identity and OAuth proof assembly.
- [Normative platform profiles](../../../../specs/platform-ceremonies.md): encodings and proof statements.

[index.ts](../src/platforms/index.ts) composes each version's URL builder and proof validators
directly, derives public types and dispatches structural validation. URL modules
contain authorization request construction; `types.ts` owns identity/proof shapes.
[authorization.ts](../src/platforms/authorization.ts) provides shared digest/PKCE helpers;
[platforms.assets.ts](../src/platforms/platforms.assets.ts) aggregates data-only declarations.

| Platform | Authorization URL | Prover leaf | Pipeline contract |
|---|---|---|---|
| Google v1 | [url](../src/platforms/google/1/url.ts) | [prover](../src/platforms/google/1/prover.ts) | [Google](pipelines.md#google) |
| X v1 | [url](../src/platforms/x/1/url.ts) | [prover](../src/platforms/x/1/prover.ts) | [X](pipelines.md#x) |
| GitHub v1 | [url](../src/platforms/github/1/url.ts) | [prover](../src/platforms/github/1/prover.ts) | [GitHub](pipelines.md#github) |

Execution imports its asset declarations; declarations never import execution.
See the [qualification record](qualification.md) before treating a pipeline
as a qualified real OAuth ceremony.

### GitHub authorization response

GitHub v1 requires the decoded `iss` value to equal
`https://github.com/login/oauth` on both success and error returns. This is the
[advertised issuer](https://github.com/.well-known/oauth-authorization-server/login/oauth)
and follows [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4).
The code-return parser accepts bounded `error_description` and `error_uri` on
error responses, but neither field is displayed, logged or delivered. Duplicate
fields, aliases, malformed escapes, mixed outcomes and wrong/missing GitHub
issuers reject before token exchange. Valid equivalent percent encodings decode
once without requiring URLSearchParams' preferred spelling. X does not inherit
GitHub's issuer requirement.
