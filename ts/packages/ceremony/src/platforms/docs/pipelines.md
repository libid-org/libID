# Platform proof pipelines

## Platform pipelines

### Shared startup

Prover imports its runtime concurrently with joining selected-profile asset
prefetch. Once both are ready and the OAuth return is accepted, platform input
preparation and dedicated proof-worker startup run concurrently. Backend
initialization needs the selected circuit, not the ceremony's private inputs.
Witness execution waits for both prepared inputs and backend readiness.

Inside the proof worker, initialize ACVM and ABI WASM concurrently, then load
Noir, Barretenberg, and the circuit concurrently before initializing the backend.
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
release generates an UltraHonk proof with
`backend.generateProof(witness, { verifierTarget: 'evm' })`. This explicitly
selects ZK-Honk with the Keccak transcript, not the library's default or
`evm-no-zk`. The option belongs to the pinned platform proving configuration;
it is not selected from the caller's chain. Qualification verifies the browser
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
archive. The [CCDP Distribution contract](../../../docs/distribution.md#proving-assets) owns their
serving.
Prover decodes `AppStartProver.ledgerId` through `@libid/ledger` and uses
`isTestnet()` to resolve the code-pinned
[notary address](../../prover/notarization/docs/notarization.md#notary-address). The ledger input cannot supply
an arbitrary endpoint or select a circuit or bb.js version. Both networks use the same assets
and prefetch graph; Google does not use a notary.

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
execution starts once both inputs and backend are ready. No TLSNotary session
is created for Google.

The semantic groups flatten to exactly 56 bb.js public-input fields. The module
requires a canonical unpadded base64url nonce encoding exactly 32 bytes and
uses those bytes as the candidate authorization digest. Neither Prover nor
Client compares that candidate to the Application's separately constructed
digest; `AppStartProver` carries no expected-digest field. The circuit
re-encodes the candidate as the exact nonce and verifies the RS256
signature and signed claims. The module then generates one proof and returns it
with the exact signed audience, subject, email and expiry plus the selected JWK
modulus as `GoogleProofV1`, with no attestation or flattened public-input array.
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
   while the proof backend initializes. Each session owns its own WebSocket.
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
   bearer, its length, and those blinders. Execute the witness and generate the
   proof as soon as the backend is ready, overlapping final notarization work.
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

`platforms/github/1/prover` first sends the captured code, derived verifier,
and resolved `notaryAddress` to the fixed OAuth bridge token-exchange route.
The Bridge and browser identity session use that exact address, including any
build-time development override; the Bridge performs no network classification.
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
[OAUTH_BRIDGE.md](../../../docs/oauth-bridge.md#github-token-endpoint).

The module then runs the same `bearer-link` circuit with the token-exchange and
identity blinders. Its public-input count and order are identical to X: 64
fields representing token commitment then identity commitment. Delivery
contains `bearerLinkProof`, the token-exchange and identity attestations with
their decoded views, and `identity` with `platformId: 'github'`, the attested
token-request client identifier, and `/user`'s `id` and `login`. The browser
decodes the server-returned token attestation itself; the bridge's JSON response
does not gain a `decoded` field. GitHub-specific server exchange and transcript
construction therefore remain platform code; no GitHub-specific proving
circuit or proving engine exists.
