# `@libid/ceremony` proof-generation architecture

This document defines the implementation behind CCDP's Prefetch and Prover:
closed platform pipelines, proof delivery, progress steps, release assets,
proving toolchain, prefetch/cache behavior, and worker graph. CCDP owns the
browser documents, routes, isolation, presentation, messages, and navigation.

The package API and result lifecycle are defined in
[ARCHITECTURE.md](ARCHITECTURE.md). The browser boundary and its input/output
messages are defined by [CCDP](CCDP.md#prover-get-prover). This document owns only the
proof-generation implementation and its pinned asset selection; the CCDP Distribution
serves local proving resources from an origin independent of the
[OAuth bridge](OAUTH_BRIDGE.md), while declared external resources retain their
upstream URLs.
TLSNotary sessions, transcript disclosure, and attestation delivery are defined
in [NOTARIZATION.md](NOTARIZATION.md).
Normative proof relations and authorization semantics remain in the
[common ceremony rules](../../../specs/ceremony-common.md) and
[identity-platform ceremonies](../../../specs/platform-ceremonies.md).

## Execution boundary

After CCDP accepts one `AppStartProver`, the selected platform/version prover
leaf parses the retained OAuth query/fragment from the private navigation
handoff. It enforces that profile's exact return transport and field grammar,
client checks, and state matching against the authenticated ceremony ID and
CCDP version before any token exchange or proof work. A valid denial produces
cancellation; a malformed or mismatched return produces technical failure.
The Prover entrypoint maps those outcomes to `CancelCeremony` or
`AbortCeremony` without adding message logic to the platform leaf.

For accepted OAuth, the leaf joins the selected asset fetches, constructs its
witness, generates its proof, and returns bounded platform steps followed by
one platform proof or a sanitized technical failure. Platform and proving logic
see no popup connection, navigation, carrier, or continuity mechanism.

Before OAuth, the Prefetch implementation asks the shared Worker to start the
same selected-profile asset single flights. OAuth navigation destroys that
document; the Worker and browser caches preserve the useful fetch work for the
later Prover.

The prover does not receive the operation domain, chain ID, transaction data,
authorization nonce, or expected Authorization Digest. Google exposes the
signed token nonce as a proof public input; X and GitHub expose the attested
code verifier. The Ledger Verifier matches that binding to the
Authorization Digest it recomputes from `OAuthProof`.

The prover constructs each platform proof's shared `Identity` and complete
decoded attestation views from its evidence. It does not assemble or verify
`OAuthProof`, call a Ledger Verifier, or persist credential-bearing state. The
Ceremony Client structurally validates the selected delivery variant and wraps
it with retained ceremony fields; it does not repeat evidence parsing or
identity extraction. Prover inputs, workers, witnesses,
and outputs are cleared after delivery, `CancelCeremony`, `AbortCeremony`, failure, or context
destruction.

## Proof delivery

Google delivers `identityProof`, a shared `identity` containing the exact signed
audience, subject, and email, the signed expiry, and the selected JWK modulus
as `GoogleProofV1`. It delivers no attestation. The Prover matches the signed
audience to the request's frozen client identifier. The Ceremony Client adds
the common authorization fields to assemble `OAuthProof<'google'>`.
The Google adapter flattens the named values into the circuit's 56 public-input
fields only at the verifier/transaction-encoding boundary; the Ceremony Client
does not verify the proof.

For X, `ProverDeliverProof.proof` is `XProofV1`; for GitHub it is `GitHubProofV1`.
Each independently contains `identity`, `bearerLinkProof`, and the named
`tokenAttestation` and `identityAttestation`.
Each attestation preserves the byte-exact attested-data serialization and its
associated signature as produced by the pinned notary client. The signature
covers exactly those attested-data bytes, including server identity, evidence
time, transcript lengths, reveals, and commitments. Each attestation also
contains the existing decoder's complete `decoded` view, defined in
[NOTARIZATION.md](NOTARIZATION.md#canonical-attested-data-decoder). It preserves
authority, creation time, transcript lengths, every reveal, and every
commitment; it does not add hidden bearer bytes, commitment openings, or
witnesses. The prover never normalizes or reserializes the signed bytes or
accepts a caller-supplied replacement.

The platform leaf extracts `identity.oauthClientId` from the token-request
evidence and `identity.userId`/`identity.userName` from the identity-response
evidence using its exact profile grammar. Provisional transcript parsing may
overlap proving, but delivery waits for correlation with the final signed
attestations. The Client does not repeat this extraction.

The link circuit's two 32-byte bearer commitments are public inputs to the
circuit, ordered token then identity. They are not separate proof-input fields:
the prover discards bb.js's flattened public-input array, and the Platform
Verifier reconstructs the two values from the corresponding verified
attestations before checking the proof. They remain visible in each
attestation's decoded commitments for inspection.
The circuit proves only that one hidden bearer opens both commitments; PKCE
binds the token exchange to the Authorization Digest outside the circuit.

The platform delivery-to-output mapping is closed, but CCDP treats `proof` as
an unknown logical value:

| Platform | Prover delivery | Ceremony Client additions | OAuth proof |
|---|---|---|---|
| Google | `GoogleProofV1 { identity, identityProof, tokenExpiresAt, signingKeyModulus }` | common fields | `OAuthProof<'google'>` with ceremony version `1` |
| X | `XProofV1 { identity, bearerLinkProof, tokenAttestation, identityAttestation }` | common fields | `OAuthProof<'x'>` with ceremony version `1` |
| GitHub | `GitHubProofV1 { identity, bearerLinkProof, tokenAttestation, identityAttestation }` | common fields | `OAuthProof<'github'>` with ceremony version `1` |

Each platform/version `prover` leaf constructs its exact proof object. Its
side-effect-free `types` leaf owns the matching runtime validator dispatched by
`platforms/index`. The
validator is selected from the live Ceremony's platform and ceremony version,
not from a discriminator inside the nested value. It rejects unknown fields, malformed arrays and bytes, and
profile-bound violations and a mismatched `identity.platformId`, then returns a
typed `ProverDeliverProof`. It checks the decoded view's structure, not its
agreement with signed bytes; that decoding belongs to the Prover. CCDP never
changes when another platform proof type is added.

The common fields are platform ID, platform ceremony version, operation domain,
authorization nonce, and transaction data. The
exact records are defined in the
[package architecture](ARCHITECTURE.md#result-and-lifecycle). The Ceremony
Client adds no chain ID, Authorization Digest, second identity copy, code
verifier, evidence-time summary, verifier address, or verification-key field.

The platform pipelines request the profile's exact reveals and commitments.
Attestation authenticity, authority, method and path, request grammar,
transcript tiling, bearer framing, identity extraction, and evidence time are
authoritative Platform Verifier checks over those signed bytes. Decoded views
and extracted identity are browser conveniences, not alternate authorities or
additional ledger inputs. GitHub repeats the token-session subset specified
below as a local precondition before using a server-returned bearer; that
repeat does not make browser acceptance authoritative.

## Browser notarization

X and GitHub use `prover/notarization`, one internal TypeScript adapter over
the pinned raw TLSNotary WASM API. Platform-version prover leaves supply their exact
request, response parser, and transcript layout; the adapter owns the shared
session, reveal, reclaimed-channel, attestation-delivery, and
commitment-correlation mechanics. The full boundary, disclosure model, three
browser call sites, and attestation handoff are defined in
[NOTARIZATION.md](NOTARIZATION.md).

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
archive. The [CCDP Distribution contract](CCDP_DISTRIBUTION.md#proving-assets) owns their
serving.
Neither an application nor `AppStartProver` selects a notary, circuit, or
bb.js version.

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
derives the candidate authorization digest from the signed nonce; the circuit
re-encodes it as the exact unpadded base64url nonce and verifies the RS256
signature and signed claims. The module then generates one proof and returns it
with the exact signed audience, subject, email and expiry plus the selected JWK
modulus as `GoogleProofV1`, with no attestation or flattened public-input array.
The Prover builds `identity` with `platformId: 'google'`, `oauthClientId` from
`aud`, `userId` from `sub`, and `userName` from `email`, without normalization.
The Ceremony Client checks result structure and wraps it; only Ledger Verifier
verification makes these fields authoritative.

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

`platforms/github/1/prover` first sends the captured code and derived verifier
to the fixed OAuth bridge token-exchange route. The bridge uses its
confidential client secret, performs the token-exchange TLSNotary session, and
returns the bounded access token, token attestation, and `bearerOpening`: the
canonical unpadded base64url encoding of the token session's exact 16-byte
TLSNotary blinder. The
browser exact-validates the selected version's token response, attestation
encoding and correlation, request bindings, and bearer opening before using
the bearer in its own fixed `/user` TLSNotary session. Local verification of
the notary signature is optional defense in depth; the downstream Platform
Verifier remains authoritative. That session commits the bearer and reveals the
canonical `id` and `login` ranges. The OAuth bridge route is defined in
[OAUTH_BRIDGE.md](OAUTH_BRIDGE.md#github-token-endpoint).

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

## Platform progress

Each profile owns a closed catalog of advisory diagnostic spans after
`AppStartProver`. The Ceremony Client owns the common `proof-generation`
stage; platform-version prover leaves emit only their version-owned spans. Each
catalog entry also owns one bounded user-facing label. Labels describe current
work, such as **Loading proving assets**, **Connecting to notary**, **Preparing
proof inputs**, or **Generating proof**; they never contain a credential,
identity, URL, caller value, raw exception, or raw service error.
Collection, privacy, aggregation, and optional export are defined in
[METRICS.md](METRICS.md).

Every profile includes these spans:

- readiness: parent `prover-readiness`, with `asset-prefetch` and `runtime-load`
  children which may overlap;
- proof engine: `proof-worker-bootstrap` → `proof-wasm-load` →
  `proof-circuit-load` → `proof-backend-initialization` → `witness` → `proof` →
  `proof-backend-destroy`.

Profiles add these spans alongside proof-engine initialization:

| Profile | Platform-step codes |
|---|---|
| `google` | `token-decoding` → `signing-key-fetch` → `signing-key-selection` → `circuit-inputs` |
| `x` | `notary-worker-bootstrap` → `notary-wrapper-load` → `notary-wasm-instantiation` → `notary-worker-initialization`; concurrent parents `token-session` and `identity-session`, each containing `*-websocket-connect` → `*-prover-setup` → `*-platform-request` → `*-reveal` → `*-attestation`; identity adds `identity-credential-wait` between setup and request; `circuit-inputs` starts once both required openings are available, without waiting for attestations |
| `github` | `token-exchange-request` → `token-exchange-validation` → `notary-initialization` → `identity-session` → `identity-attestation` → `circuit-inputs` |

`prover-readiness` covers awaiting selected artifact single flights; downloads
may already have started during prefetch. X's session setup overlaps; only
`identity-platform-request` waits for the parsed token-response bearer.
`identity-credential-wait` measures that remaining wait after identity setup
completes, separate from setup and request latency. If the bearer is already
available it still emits a started/completed pair with no artificial delay.
`witness` waits for `circuit-inputs` and `proof-backend-initialization`, not for
the attestation spans. `proof-wasm-load` covers concurrent ACVM/ABI initialization;
`proof-circuit-load` covers concurrent Noir/Barretenberg/circuit loading.
GitHub exposes its one server request and local validation
of the complete response, but no fictional server-internal progress.

On a successful run, each code emits `started` once and `completed` once. On
any run, every started span emits exactly one terminal `completed` or `failed`;
a failure does not invent later spans. Message order preserves that per-span
lifecycle and the parent/dependency rules above; unrelated spans may overlap
and therefore have no total order. A cache hit emits the same lifecycle. OAuth,
isolation, delivery, and Client result assembly are represented elsewhere and do
not add platform steps. Events remain credential-free; implementations may
derive durations from their prover-stamped timestamps.

Each leaf span has one nonnegative presentation weight based initially on
measured typical duration for that platform/version. Parent spans have zero
weight so nested and parallel work is not counted twice. Leaf weights form one
positive closed total. Every emitted event carries
`progress = 0.95 * completedWeight / totalWeight`; a `started` event changes the
label and shimmer but retains the last completed weight, while a `completed`
event advances the monotonic target. Parallel completion order therefore cannot
move progress backwards. `ProverDeliverProof`, outside `PlatformStep`, alone
makes the renderer show `1`.

Weights improve the rough visual distribution of milestones but make no time
or completion guarantee. The renderer does not make the bar creep between
events. Updating labels or weights is presentation tuning; changing codes or
their causal lifecycle remains a platform-ceremony-version change.

## Shared toolchain and assets

Each platform/version's lightweight `assets` leaf composes its pinned circuit
and shared integration resources into its selected-profile set. Shared bb.js,
notarization, and circuit declarations are referenced, not copied between
platforms; [resource ownership and collection](CCDP_DISTRIBUTION.md#source-declarations)
define the import boundary. A ceremony fetches only its composed set and emitted
execution dependencies. X and GitHub reuse the notarization client and
`bearer-link` circuit; Google fetches neither when it does not need them.

The ceremony package pins the compatible Noir and bb.js dependencies in code.
Their JavaScript is bundled into the static prover distribution, not imported
from a CDN on demand. Internal companion chunks are not deployment
configuration. The build owns local toolchain worker/WASM locations and pins
bb.js's native external common reference string (CRS) requests. No runtime
configuration can replace those dependencies.

The [CCDP Distribution](CCDP_DISTRIBUTION.md#proving-assets) serves companion chunks, spawner
and nested worker modules, WASM, and circuits from immutable same-origin paths.
The resource table currently marks CRS as `external`: those bodies are
prefetched and fetched directly from Aztec's CDNs using bb.js's native URLs and
ranges. Resource resolution, not platform code, distinguishes local and
external locations. Prefetch uses the same resolved request as execution. The
Prefetch bootstrap which installs the Worker cannot depend on it during its
first evaluation; it is contained in the versioned document or uses an
implementation-private immutable chunk.

The ceremony package pins one launch-wide structured reference string size,
`SRS_SIZE = 2 ** 18`; SRS size is code, not deployment data:

| Profile | Pinned libID assets | Measured circuit size | Pinned BN254 SRS size |
|---|---|---:|---:|
| `x` | shared notarization client and `bearer-link` circuit descriptor | 42,006 | 262,144 (2^18) points |
| `github` | the same two shared artifacts as X | 42,006 | 262,144 (2^18) points |
| `google` | `oidc_google` circuit descriptor | 179,443 | 262,144 (2^18) points |

The pinned current-circuit heavy-resource subtotal is:

| Profile | Non-CRS artifact bodies | Pinned CRS bodies | Known heavy subtotal |
|---|---:|---:|---:|
| `google` | 8,092,815 bytes (7.72 MiB) | 12,583,040 bytes (12.00 MiB) | 20,675,855 bytes (19.72 MiB) |
| `x` or `github` | 24,683,695 bytes (23.54 MiB) | 12,583,040 bytes (12.00 MiB) | 37,266,735 bytes (35.54 MiB) |

These resource-body counts use Nargo `1.0.0-beta.25`, native bb `5.2.0`, and
bb.js `5.2.0`, as recorded by
[`libid-circuits v0.3.0`](https://github.com/libid-org/libid-circuits/releases/tag/v0.3.0),
whose target is the source commit pinned above. `oidc_google.json` is 1,312,738
bytes and `bearer_link.json` is 171,956 bytes. The pinned bb.js
`barretenberg-threads.wasm.gz` is 3,071,085 bytes. The pinned Noir runtime adds
3,049,596 bytes of `acvm_js_bg.wasm` and 659,396 bytes of
`noirc_abi_wasm_bg.wasm`; every profile shares these code-owned build assets.
The [`libid-org/notary v0.2.0`](https://github.com/libid-org/notary/releases/tag/v0.2.0)
browser bundle contains a 17,731,662-byte `tlsn_wasm_bg.wasm`.

Gate count alone does not determine the deployable SRS floor. bb.js 5.2's 4 MiB
verification chunks make `bearer_link` require at least 2^17 despite its 2^16
mathematical ceiling; `oidc_google` requires 2^18. Launch pins 2^18 for every
profile so one download serves multi-platform users, at a 4 MiB cost for an
X/GitHub-only user. Split it only if measurements justify the extra selection
and cache-upgrade paths.

The first ceremony downloads the one shared SRS set. A later ceremony for any
platform reuses it and fetches only missing profile assets. X/GitHub after
Google fetches 17,903,618 bytes of notary WASM and the bearer circuit; Google
after X/GitHub fetches only its 1,312,738-byte circuit.

The counts are before HTTP content encoding and exclude CCDP HTML, entry code,
worker JavaScript graph, headers, OAuth/notary traffic, and attestations. The
CRS subtotal is fetched from Aztec rather than included in the static build.
These are reproducible heavy-resource subtotals, not a promise about total
transferred bytes. The JavaScript graph does not exist yet and must publish its
own measured size when built.

The pinned bb.js 5.2.0 build owns the compressed CRS downloader and
[`srsSize` option](https://github.com/AztecProtocol/aztec-packages/pull/23419),
and includes
[Aztec #25290](https://github.com/AztecProtocol/aztec-packages/pull/25290), which
persists `Crs.new()` downloads. The dependency pins the CDN request paths below;
bundling its JavaScript does not bundle or relocate those CRS bodies.

### Dependency asset resolution

Dependency loaders use their supported integration points. ACVM/ABI receives
explicit absolute WASM URLs as above. bb.js JavaScript and worker modules are
bundled; its browser package's default WASM is
[embedded gzip data](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/scripts/browser_postprocess.sh),
not another remote JavaScript dependency. This build emits that WASM as a
standalone immutable asset and supplies the supported
[`wasmPath`](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/src/barretenberg_wasm/fetch_code/browser/index.ts)
option, accounting for the loader's `-threads` suffix. Prefetch downloads only
the selected WASM, not an additional embedded/default copy.

The integration always supplies both path options, even while CRS must remain
external:

```ts
await Barretenberg.new({
  threads: proofThreads,
  srsSize: SRS_SIZE,
  wasmPath: resolvedAssets.wasmPath,
  crsPath: resolvedAssets.crsPath,
})
```

These locations come from the build-owned resource table. The option is named
`crsPath`, not `srsPath`; `srsSize` selects the point count. Neither proving code
nor the Application selects an asset mode or duplicates its URL configuration.

The pinned unpatched
[browser CRS loader](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/src/crs/net_crs.ts)
uses fixed Aztec URLs; the browser implementation does not consume `crsPath`
as a URL override. Until the browser-path patch is integrated,
`resolvedAssets.crsPath` must therefore equal the native primary CDN base and
CRS entries remain external. Passing the option is not evidence it worked:
qualification observes actual fetches and rejects a declaration the loader
ignores. No global-fetch patch, URL substitution, or stripped Range disguises
this limitation.

With browser path support, the same call may resolve to an immutable
Distribution directory instead. An explicit base selects all BN254 G1, G2,
and Grumpkin requests and must not silently fall back to a different source.
Both raw and bb.js processed-CRS caches must distinguish the selected source;
old native-CDN cache entries cannot bypass a custom selection. Changing the
resource mode then changes build resolution and generated policy, not platform
or proving control flow.

For bb.js 5.2.0 and `SRS_SIZE = 2 ** 18`, prefetch and execution use these GET
requests with `cache: 'force-cache'`:

| CDN request path | Required `Range` | Expected body bytes |
|---|---|---:|
| `/g1_compressed.dat` | `bytes=0-8388607` | 8,388,608 bytes: compressed BN254 G1 prefix |
| `/g2.dat` | absent | 128 bytes: BN254 G2 |
| `/grumpkin_g1_v2.dat` | `bytes=0-4194303` | 4,194,304 bytes: Grumpkin G1 prefix |

On the current unpatched loader, each path uses
`https://crs.aztec-cdn.foundation` first and `https://crs.aztec-labs.com` on
failure, matching bb.js's fallback. Do not fetch
both mirrors speculatively. The patched explicit-base path uses only the
selected source; its request declaration and prefetch follow that behavior.
Prefetch uses CORS mode and the native default
`credentials: 'same-origin'`, which sends no credentials to either CDN.
The exact URL, method, and range select a cached flight; a full-file fetch or
different prefix cannot masquerade as the requested prefix. These URLs carry
no ceremony input, query, or fragment.

For ranged CRS responses, require `206`, the exact expected byte count, and
matching start/end when `Content-Range` is exposed. Reject an ignored range
instead of downloading a multi-gigabyte full file. G2 requires `200` and its
exact byte count. Both hosts must support readable CORS under isolation, but
neither an exposed `Content-Range` nor a particular MIME/cache header is a
browser acceptance requirement: the current fallback hides that header, and
some primary resources omit MIME. Validate the response URL against the pinned
hosts/paths and reject opaque, failed, truncated, or mismatched responses.

The raw-CRS cache is range-aware. Native
[`Cache.put`](https://w3c.github.io/ServiceWorker/#cache-put) rejects `206`
responses, so retain validated prefix bytes and response metadata as an
internal cache entry keyed by the exact URL and range, then reconstruct the
ranged response for the dependency. Do not directly `cache.put` a `206` or
serve a prefix as a cached whole file. This storage detail adds no public route
and does not relocate the CDN request. Each single-flight joiner receives a
readable response body. Failed flights leave no cache hit; a canceled joiner
does not cancel another ceremony's shared fetch.

The integration keeps one reviewed request set beside the bb.js pin; CSP and
prefetch derive from it. A dependency-bump test runs the installed browser
loaders with an observing fetch stub and compares their actual URLs, methods,
ranges, and fallback behavior against that set. The test also supplies a custom
base and verifies it is honored before allowing distributed CRS; an unpatched
loader's ignored option must not pass that qualification. An added, removed,
or changed request fails until the declaration, prefetch, response policies, and size
accounting are reviewed together. It must exercise the loaders, not merely
compare two copies of constants or automatically accept newly discovered URLs.

Release qualification also runs actual initialization against the generated
distribution and live CDNs, first with empty caches, then after prefetch. Block
unlisted external asset hosts, not the declared Aztec hosts. Force primary
failure to exercise the real fallback, and check availability, body sizes,
CORS under both isolation responses, and cached reuse without another network
download of the same URL/range. Repeat with partial caches, concurrent
profiles, worker restart, and the nested-worker graph. This catches broken
upstream links and headers that an offline loader test cannot detect.

## Prefetch and cache lifecycle

Every ceremony attempts consent-overlapped prover prefetch. It is fixed
behavior, not configuration or action input. CCDP's Prefetch implementation
registers the shared module Service Worker and asks it to start only the
selected platform/version profile's artifact single flights. Prefetch, Prover,
and Worker implementations come from one compatible package release.

After registration, the Window branch selects the newest registration
candidate, waits through installation and waiting until it becomes active,
posts the exact selected profile to that Worker, and reports dispatch without
waiting for downloads. It never dispatches to a stale active Worker while a
newer candidate is installing or waiting. The Worker composes the popup
package's bounded MessagePort keeper with the selected immutable-asset and CRS
single flights in one canonical root registration, regardless of stale nested
registrations left by earlier deployments. A Worker which
receives the prefetch request exact-validates it and attaches the fetch work to
the message event with `event.waitUntil`.

The worker calls `skipWaiting()` during install and `clients.claim()` during
activation so later prover documents use the selected release rather than a
stale controller. Activation does not proactively delete reusable immutable
Cache Storage entries or bb.js CRS data. Immutable URLs keep already loaded
documents pinned; a live ceremony may still fail closed across deployment
rotation as defined by the [CCDP Distribution contract](CCDP_DISTRIBUTION.md#protocol-resources).

The Prefetch bootstrap accepts only the closed, cleared profile selected by its
fragment and selects its resolved resource set from the lightweight catalog.
Having metadata for all supported profiles does not fetch unselected assets.
Neither fragment nor message can supply an asset path.

Prefetch and its Worker contain fetching/cache logic and resource metadata,
not platform execution or proving/notarization runtime code. They may fetch
the selected emitted JavaScript chunks and workers as inert bytes for later
execution; fetching those scripts does not import or execute them. The
`/prover` HTML response, including its embedded entrypoint, is fetched by
navigation and is not part of this asset prefetch. Its separately fetched
dependencies are. Bundle qualification checks the import boundary as well as
the emitted code, rather than relying on tree-shaking to remove unused runtimes.

The prefetch branch contains no OAuth or proof input. The separately imported
popup handler owns only its bounded temporary continuity entries. The branch
owns each selected asset fetch from the first byte and keys single flights by
canonical URL plus range where applicable. It fetches missing runtime assets, selected circuits,
WASM, and the pinned raw BN254/Grumpkin CRS bodies concurrently, sharing pending
asset and range-keyed CDN raw-CRS fetches between requests. It extends the
initiating worker event through completion. Prefetch warms bytes, not computation: it does not
initialize proof backends, preprocess CRS, or retain WASM instances or
TLSNotary sessions across OAuth. Merely importing bb.js is not CRS prefetch.

Ordinary local-asset prefetches use `credentials: 'same-origin'`, matching
native module and worker requests. Fetch-event handling preserves the admitted
request's URL and response semantics so Firefox can reuse a prefetched worker
response rather than refetching or synthesizing a different module. CDN CRS
requests follow the range-aware cache contract above; they are CORS fetches,
not cross-origin worker-script imports.

Its package-private prefetch call is an implementation detail, not a CCDP
message or exported ceremony API. The worker intercepts only exact local-asset
and external CRS requests in the selected platform/version leaf's pinned
prefetch set. It
leaves every other request to the browser unchanged: ceremony routes, the
GitHub token exchange, platform APIs, OAuth navigation, HTML, and configuration
are never cached, rewritten, or synthesized by this worker.

As soon as active-worker selection and the prefetch request settle, without
waiting for download completion, the Prefetch emits CCDP's `PrefetchStarted`.
Registration or activation failure is terminal under the package's fixed
prefetch/cache contract; artifact fetch failure records no weaker mode and
leaves proving on the identical cold path. The active prover resolves
the same profile using the exact `AppStartProver` platform/version. Ordinary asset
requests join an in-flight fetch or read the completed Cache Storage entry. It
joins raw-CRS fetches in the same way. Backend initialization uses the explicit
options above and keeps bb.js's native processed-CRS IndexedDB cache enabled;
on a miss its normal CRS loading consumes the prefetched raw responses.
The worker does not reproduce that processing or maintain a
second processed-CRS cache.

A later ceremony reuses every repeated artifact URL and the same CRS entries;
only missing profile assets are fetched. OAuth navigation therefore neither
restarts shared work nor downloads unrelated profiles. The Prefetch and active
Prover share the CCDP origin and worker registration, so the final Prover
reuses the same fetches and caches.

A new document reconnects to the worker rather than awaiting a Promise owned
by a destroyed prefetch document. Completed asset and raw-CRS responses live in
Cache Storage; processed CRS from backend initialization lives in bb.js's
native IndexedDB cache. If the worker stops midway, completed responses remain
usable and missing resources follow the normal fetch path. No separate durable
completion marker exists.

Service-worker asset caches are separated by asset release, while unchanged
content-addressed URLs remain reusable across releases. A new release checks
retained caches for those identical URLs rather than forcing downloads merely
because the cache namespace changed. Stable protocol endpoints revalidate;
immutable asset paths do not change without changed content or response policy.

Registration and activation failure are terminal. A missing or malformed
selected profile also fails before OAuth. Fetch, eviction, or quota
failure follows the identical selected-profile cold fetch path and changes
latency only; it never weakens isolation, worker count, or verification. Warm
state is never a ceremony checkpoint.

### PoC measurements and rationale

The retained PoC optimizations above reportedly brought X proving to roughly
six seconds in the tested setup; this is not a cross-browser latency target or
an OAuth-inclusive timing guarantee. In a small Chromium A/B sample, custom
pre-OAuth CRS preprocessing reduced cold backend initialization by about 740 ms
but total post-OAuth proving by only about 200 ms. It was removed: warm runs
already benefited from the native processed-CRS cache. Preserve raw-byte
prefetch and native caching without introducing another preprocessing pipeline.

Concurrent span durations are not additive elapsed time. A displayed prefetch
benefit estimates work completed before proving, not a measured counterfactual
speedup. The active path skips local cryptographic proof verification; a PoC
UI label saying “verified proof” does not establish otherwise. Ledger Verifier
acceptance remains authoritative.

## Execution isolation

[CCDP](CCDP.md#documents-and-routes) owns the Prover's isolated execution
context; the [CCDP Distribution contract](CCDP_DISTRIBUTION.md#protocol-resources) owns its HTTP
policy and declared local/external resource graph. No request parameter selects a document
role, asset, or CSP. `AppStartProver` carries the Application's frozen
`redirectUri`; its origin selects the OAuth Bridge for GitHub's fixed token
route. The implementation exact-validates that canonical HTTPS origin and
derived route before use. The response does not embed or enumerate Bridge
origins and remains byte-identical across them.

The top-level document runs the multithreaded prover configuration only after
confirming cross-origin isolation and shared memory. No unisolated or
single-threaded fallback changes platform semantics, workers, cache policy, or
proof output.

## Compatibility

A live prover pins its loaded modules and assets. Proof-semantic changes use
`PlatformCeremonyVersion`; host, cache, and equivalent SRS-fetch changes do not.
All version axes are defined in
[ARCHITECTURE.md](ARCHITECTURE.md#versioning-and-compatibility).
