# `@libid/ceremony` proof-generation architecture

This document defines the implementation behind CCDP's Prefetch and Prover:
closed platform pipelines, proof delivery, progress steps, release assets,
proving toolchain, prefetch/cache behavior, and worker graph. CCDP owns the
browser documents, routes, isolation, presentation, messages, and navigation.

The package API and result lifecycle are defined in
[ARCHITECTURE.md](architecture.md). The browser boundary and its input/output
messages are defined by [CCDP](documents.md#prover-get-prover). This document owns only the
proof-generation implementation and its pinned asset selection; the CCDP Distribution
serves local proving resources from an origin independent of the
[OAuth bridge](oauth-bridge.md), while declared external resources retain their
upstream URLs.
TLSNotary sessions, transcript disclosure, and attestation delivery are defined
in [NOTARIZATION.md](notarization.md).
Normative proof relations and authorization semantics remain in the
[common ceremony rules](../../../../specs/ceremony-common.md) and
[identity-platform ceremonies](../../../../specs/platform-ceremonies.md).

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
code verifier. The Ledger Verifier matches that binding to the Authorization
Digest it recomputes from the composition's submitted operation inputs and
the returned ceremony version and authorization nonce.

The prover constructs a shared `Identity` beside the platform proof, and complete
decoded views inside its attestations, from its evidence. It does not assemble
or verify `OAuthProof`, call a Ledger Verifier, or persist credential-bearing state. The
Ceremony Client structurally validates the identity and selected proof variant,
then returns `identity` and `oauthProof` separately; it does not repeat evidence
parsing or identity extraction. Prover inputs, workers, witnesses,
and outputs are cleared after delivery, `CancelCeremony`, `AbortCeremony`, failure, or context
destruction.

## Proof delivery

Google delivers `GoogleProofV1` containing `identityProof`, the signed expiry,
and the selected JWK modulus, beside a shared `identity` containing the exact
signed audience, subject, and email. It delivers no attestation. The Prover
matches the signed audience to the request's frozen client identifier. The Ceremony Client adds
only the selected ceremony version and retained authorization nonce to assemble
`OAuthProof<'google'>`. The Google adapter takes the separate identity and
platform proof and flattens their named values into the circuit's 56 public-input
fields only at the verifier/transaction-encoding boundary; the Ceremony Client
does not verify the proof.

For X, `ProverIdentityProof.proof` is `XProofV1`; for GitHub it is `GitHubProofV1`.
Each independently contains `bearerLinkProof` and the named `tokenAttestation`
and `identityAttestation`; the shared `identity` is a sibling message field.
Each attestation preserves the byte-exact attested-data serialization and its
associated signature as produced by the pinned notary client. The signature
covers exactly those attested-data bytes, including server identity, evidence
time, transcript lengths, reveals, and commitments. Each attestation also
contains the existing decoder's complete `decoded` view, defined in
[NOTARIZATION.md](notarization.md#canonical-attested-data-decoder). It preserves
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

| Platform | `ProverIdentityProof.proof` (identity is separate) | Ceremony Client additions | OAuth proof |
|---|---|---|---|
| Google | `GoogleProofV1 { identityProof, tokenExpiresAt, signingKeyModulus }` | version and nonce | `OAuthProof<'google'>` with ceremony version `1` |
| X | `XProofV1 { bearerLinkProof, tokenAttestation, identityAttestation }` | version and nonce | `OAuthProof<'x'>` with ceremony version `1` |
| GitHub | `GitHubProofV1 { bearerLinkProof, tokenAttestation, identityAttestation }` | version and nonce | `OAuthProof<'github'>` with ceremony version `1` |

Each platform/version `prover` leaf constructs its exact proof object. Its
side-effect-free `types` leaf owns the matching runtime validator dispatched by
`platforms/index`. The
validator is selected from the live Ceremony's platform and ceremony version,
not from a discriminator inside the nested value. It rejects unknown fields, malformed arrays and bytes, and
profile-bound violations. The result validator also checks the separate
`identity` against the selected platform and frozen client, then returns a
typed `ProverIdentityProof`. It checks the decoded view's structure, not its
agreement with signed bytes; that decoding belongs to the Prover. CCDP never
changes when another platform proof type is added.

The only common `OAuthProof` fields are platform ceremony version and
authorization nonce, alongside the platform-specific `proof`. The
exact records are defined in the
[package architecture](client.md#result-and-lifecycle). The Ceremony
Client returns `Identity` separately and adds no repeated platform ID or
caller-supplied operation domain/transaction data. The composition retains
those inputs and combines them with `IdentityResult` for ledger submission;
Google's verifier input adapter also consumes the separate identity. The Client
adds no chain ID, Authorization Digest, second identity copy, code verifier,
evidence-time summary, verifier address, or verification-key field.

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
[NOTARIZATION.md](notarization.md).

## Platform pipelines

See [Platform proof pipelines](pipelines.md).

## Platform progress

Each profile owns a closed catalog of advisory diagnostic spans after
`AppStartProver`. The Ceremony Client owns the common `proof-generation`
stage; platform-version prover leaves emit only their version-owned spans. Each
catalog entry also owns one bounded user-facing label. Labels describe current
work, such as **Loading proving assets**, **Connecting to notary**, **Preparing
proof inputs**, or **Generating proof**; they never contain a credential,
identity, URL, caller value, raw exception, or raw service error.
Collection, privacy, aggregation, and optional export are defined in
[METRICS.md](metrics.md).

Every profile includes these spans:

- readiness: parent `prover-readiness`, with `asset-prefetch` and `runtime-load`
  children which may overlap;
- proof engine: `proof-worker-bootstrap`, then concurrent `proof-wasm-load`,
  `proof-circuit-load` and `proof-backend-initialization`; `witness` may start
  after the first two and input preparation, overlapping backend initialization.
  Both witness and backend must finish before `proof` → `proof-backend-destroy`.

Profiles add these spans alongside proof-engine initialization:

| Profile | Platform-step codes |
|---|---|
| `google` | `token-decoding` → `signing-key-fetch` → `signing-key-selection` → `circuit-inputs` |
| `x` | `notary-worker-bootstrap` → `notary-wrapper-load` → `notary-wasm-instantiation` → `notary-worker-initialization`; concurrent parents `token-session` and `identity-session`, each containing `*-websocket-connect` → `*-prover-setup` → `*-platform-request` → `*-reveal` → `*-attestation`; identity adds `identity-credential-wait` between setup and request; `circuit-inputs` starts once both required openings are available, without waiting for attestations |
| `github` | `token-exchange-request` → `token-exchange-validation` → `notary-initialization` → `identity-session` → `identity-attestation` → `circuit-inputs` |

`prover-readiness` covers awaiting selected artifact single flights; downloads
may already have started during prefetch. X and GitHub open their browser notary
WebSockets alongside TLSNotary runtime initialization; each session's setup waits
for both. X's session setups overlap; only `identity-platform-request` waits for
the parsed token-response bearer.
`identity-credential-wait` measures that remaining wait after identity setup
completes, separate from setup and request latency. If the bearer is already
available it still emits a started/completed pair with no artificial delay.
`witness` waits for `circuit-inputs`, `proof-wasm-load` and `proof-circuit-load`.
It can overlap `proof-backend-initialization` and attestation spans. Proof generation
waits for both witness and backend. `proof-wasm-load` covers concurrent ACVM/ABI
initialization; `proof-circuit-load` covers the circuit/key fetches and ACIR
decoding. `proof-backend-initialization` covers bb WASM, threads and CRS setup,
independently of those two resource-loading spans.
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
move progress backwards. `ProverIdentityProof`, outside `PlatformStep`, alone
makes the renderer show `1`.

Weights improve the rough visual distribution of milestones but make no time
or completion guarantee. The renderer does not make the bar creep between
events. Updating labels or weights is presentation tuning; changing codes or
their causal lifecycle remains a platform-ceremony-version change.

## Shared toolchain and assets

Each platform/version's lightweight `assets` leaf composes its pinned circuit
and shared integration resources into its selected-profile set. Shared bb.js,
notarization, and circuit declarations are referenced, not copied between
platforms; [resource ownership and collection](distribution.md#source-declarations)
define the import boundary. A ceremony fetches only its composed set and emitted
execution dependencies. Archive members retain their build-resolved full paths;
integration code obtains explicit asset locations through `assets.resolve()`,
not duplicated filenames or runtime archive globs. External declarations retain
the same URL and request options for prefetch and execution. X and GitHub reuse
the notarization client and `bearer-link` circuit; Google fetches neither when
it does not need them.

Each circuit declaration also selects the matching raw `vk` member from its
release archive (1,888 bytes for each v0.3.0 circuit). Prefetch and execution use
that same immutable key URL; X and GitHub share the bearer-link key. The engine
supplies it to bb proof generation to avoid recomputing the key, without adding
browser proof verification. Missing or empty key responses fail initialization.

The ceremony package pins the compatible Noir and bb.js dependencies in code.
Their JavaScript is bundled into the static prover distribution, not imported
from a CDN on demand. Internal companion chunks are not deployment
configuration. The build owns local toolchain worker/WASM locations and pins
bb.js's native external common reference string (CRS) requests. No runtime
configuration can replace those dependencies.

The [CCDP Distribution](distribution.md#proving-assets) serves companion chunks, spawner
and nested worker modules, WASM, and circuits from immutable same-origin paths.
The bb asset declarations use `assets.external()` for CRS: those bodies are
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
| `x` | shared notarization client, `bearer-link` circuit and key | 42,006 | 262,144 (2^18) points |
| `github` | the same shared artifacts as X | 42,006 | 262,144 (2^18) points |
| `google` | `oidc_google` circuit and key | 179,443 | 262,144 (2^18) points |

The pinned current-circuit heavy-resource subtotal is:

| Profile | Non-CRS artifact bodies | Pinned CRS bodies | Known heavy subtotal |
|---|---:|---:|---:|
| `google` | 8,094,703 bytes (7.72 MiB) | 12,583,040 bytes (12.00 MiB) | 20,677,743 bytes (19.72 MiB) |
| `x` or `github` | 19,514,543 bytes (18.61 MiB) | 12,583,040 bytes (12.00 MiB) | 32,097,583 bytes (30.61 MiB) |

These resource-body counts use Nargo `1.0.0-beta.25`, native bb `5.2.0`, and
bb.js `5.2.0`, as recorded by
[`libid-circuits v0.3.0`](https://github.com/libid-org/libid-circuits/releases/tag/v0.3.0),
whose target is the source commit pinned above. `oidc_google.json` is 1,312,738
bytes and `bearer_link.json` is 171,956 bytes. The pinned bb.js
`barretenberg-threads.wasm.gz` is 3,071,085 bytes. The pinned Noir runtime adds
3,049,596 bytes of `acvm_js_bg.wasm` and 659,396 bytes of
`noirc_abi_wasm_bg.wasm`; every profile shares these code-owned build assets.
The [`libid-org/notary v0.3.0-rc.3`](https://github.com/libid-org/notary/releases/tag/v0.3.0-rc.3)
browser bundle contains a 12,560,622-byte `tlsn_wasm_bg.wasm`.

Gate count alone does not determine the deployable SRS floor. bb.js 5.2's 4 MiB
verification chunks make `bearer_link` require at least 2^17 despite its 2^16
mathematical ceiling; `oidc_google` requires 2^18. Launch pins 2^18 for every
profile so one download serves multi-platform users, at a 4 MiB cost for an
X/GitHub-only user. Split it only if measurements justify the extra selection
and cache-upgrade paths.

The first ceremony downloads the one shared SRS set. A later ceremony for any
platform reuses it and fetches only missing profile assets. X/GitHub after
Google fetches 12,734,466 bytes of notary WASM, bearer circuit and key; Google
after X/GitHub fetches its 1,312,738-byte circuit and 1,888-byte key.

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

See [Prefetch and cache lifecycle](prefetch.md).

## Execution isolation

[CCDP](documents.md#documents-and-routes) owns the Prover's isolated execution
context; the [CCDP Distribution contract](distribution.md#protocol-resources) owns its HTTP
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
[ARCHITECTURE.md](architecture.md#versioning-and-compatibility).

## Implementation guide

Owns the shared proof engine, worker runtime, input helpers and notarization adapter.
The browser page itself lives in [ccdp/documents/prover.ts](../src/ccdp/documents/prover.ts).

- [Platform pipelines](pipelines.md): provider-specific execution order.
- [Notarization](notarization.md#implementation-guide): TLSNotary sessions and canonical attestations.
- [Prefetch](prefetch.md#implementation-guide): byte caching before execution.

[engine.ts](../src/prover/engine.ts) controls [engine.worker.ts](../src/prover/engine.worker.ts); [bb/assets.ts](../src/prover/bb/assets.ts)
owns shared backend resources. [bearerLink.ts](../src/prover/bearerLink.ts) constructs the common
bearer-link witness. [progress.ts](../src/prover/progress.ts) accounts for completed work. The browser
performs no final cryptographic proof verification; qualification uses released keys
in a separate harness.
