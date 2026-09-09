# Client API and lifecycle

## Application integration

### Client lifecycle

An application creates one client for one configured OAuth bridge:

```ts
import {
  createCeremonyClient,
  supportedPlatforms,
} from '@libid/ceremony/client'

const ceremonies = await createCeremonyClient({
  oauthBridge: 'https://oauth.example',
})
```

This is an application-owned instance, not a package-global singleton. Client
creation fetches and exact-validates `CeremonyConfig`; a configured platform is
enabled only when the installed package has a closed implementation and at
least one advertised ceremony version in common.
One closed catalog derives `PlatformId`, `supportedPlatforms`, supported
versions, and `ProofByPlatformVersion` from the same keys and validators:

```ts
import { LedgerId } from '@libid/ledger'
import * as googleV1 from './platforms/google/1/client'
import * as xV1 from './platforms/x/1/client'
import * as githubV1 from './platforms/github/1/client'

const platforms = {
  google: { versions: { 1: googleV1 } },
  x: { versions: { 1: xV1 } },
  github: { versions: { 1: githubV1 } },
} as const

export type PlatformId = keyof typeof platforms

export type SupportedCeremonyVersion<P extends PlatformId> =
  keyof (typeof platforms)[P]['versions'] & number

export type ProofByPlatformVersion = {
  [P in PlatformId]: {
    [V in SupportedCeremonyVersion<P>]:
      (typeof platforms)[P]['versions'][V] extends {
        validateProof(value: unknown): infer Proof
      } ? Proof : never
  }
}

export declare function validateProofMessage<
  P extends PlatformId,
  V extends SupportedCeremonyVersion<P>,
>(
  platformId: P,
  platformCeremonyVersion: V,
  message: ProverIdentityProof,
): ProverIdentityProof & {
  identity: Identity<P>
  proof: ProofByPlatformVersion[P][V]
}

export const supportedPlatforms: readonly PlatformId[] = Object.freeze(
  Object.keys(platforms) as PlatformId[],
)

interface CeremonyClient {
  readonly enabledPlatforms: readonly PlatformId[]
  new: <P extends PlatformId>(
    conn: PopupConnection<Message>,
    ceremonyId: string,
    ledgerId: LedgerId,
    platformId: P,
    operationDomain: Uint8Array,
    transactionData: Uint8Array,
  ) => Ceremony<P>
}
```

`validateProofMessage` dispatches to the selected version's exact `types`
validator and returns the same CCDP envelope with its proof field narrowed to
that validator's derived proof type. Any implementation-only assertion needed
to express the indexed dispatch to TypeScript remains behind this validated aggregation
boundary; the Ceremony Client performs no cast. The CCDP codec layer keeps the
proof opaque and does not import the catalog.

The prover entrypoint imports matching `prover` leaves through an exhaustive
internal dispatch. Adding a platform or version changes the catalog,
implementation, and proof validator together; no mutable registration API or
second platform list exists.

`enabledPlatforms` is the immutable intersection of `supportedPlatforms` and
the exact platform keys in validated `CeremonyConfig` that have at least one
ceremony version in common with the installed implementation. Catalog order is
stable discovery order, not a product ranking; applications may present
another order. Neither array contains OAuth clients, ceremony versions, server
configuration, or display metadata.

The composition supplies a [`LedgerId`](../../ledger/README.md) from
`@libid/ledger`, an exact 32-byte `operationDomain` hash, and bounded opaque
`transactionData`. The ledger package owns encoding/decoding, the canonical
Chain Profile hash used by the Ledger Verifier, and code-owned testnet
classification. Ceremony owns no ledger catalog or chain-specific parser.

During `new`, the client snapshots `ledgerId.encode()` and decodes it through
`LedgerId.decode`, rejecting unsupported or noncanonical identifiers before
OAuth. It derives the retained `chainId` from that immutable value's `hash()`,
requires and copies exactly 32 bytes, and validates/copies `operationDomain`.
Later changes to supplied objects or buffers cannot change the ceremony. All
authorization/proof-input construction uses that retained Chain Profile hash,
not a hash of the ledger's transport encoding.

`AppStartProver` carries the encoded ledger string. Prover first validates the
message, then reconstructs the same value with `LedgerId.decode`; the message
decoder itself still returns the original record. `isTestnet()` determines the
fixed [notary address](notarization.md#notary-address). Callers supply neither a
separate network flag nor a notary URL, and neither encoding nor classification
adds a field to the authorization digest or `OAuthProof`.

The client requires the selected platform to be enabled by validated
`CeremonyConfig`, chooses the numerically greatest ceremony version supported
both locally and by that platform, generates a fresh 32-byte authorization nonce,
computes the authorization digest and code verifier, and freezes all of those
values before constructing OAuth or allowing OAuth-platform navigation. Client
initialization has already fetched and validated `CeremonyConfig`, so `new`
does only local synchronous work.

`CeremonyClient.new` takes six positional arguments in the order shown above;
there is no separate input object. `ceremonyId` is a plain string which must be
a lowercase UUIDv4. A composition normally generates one value and calls it
`jobId` in its Job API and `ceremonyId` in this API. The equality is a
composition invariant, not a shared branded type. The identifier is not chain
authorization, but its unpredictability and one-use handling provide browser
continuity. The composition uses the same value as the supplied popup
connection's private `connectionId`; no CCDP message carries it. It is not a
second authorization secret.

`new` chooses the platform ceremony version, generates the fresh authorization
nonce, derives the code verifier from it and the Authorization Digest by the
normative Proof Key for Code Exchange (PKCE) construction where required, and
constructs the authorization request with the [CCDP-defined OAuth
state](documents.md#documents-and-routes), and returns the `Ceremony` with its launch
URL ready. OAuth `state` carries the CCDP
routing version plus `ceremonyId`; it is not a second identifier:

```ts
interface Ceremony<P extends PlatformId = PlatformId> {
  readonly launchUrl: string

  onEvent(listener: (event: CeremonyEvent) => void): () => void
  proveUserIdentity(): Promise<IdentityResult<P>>
  cancel(): Promise<void>
}
```

The caller owns launch UI and constructs the popup connection. The ceremony
package never opens a window, renders an anchor, or selects a carrier.
The caller chooses one unique non-reserved browsing-context target, uses it for
both `PopupWindow.open` and the action-specific real anchor, and passes the
resulting connection to `new`. Ceremony exposes only the initial CCDP Prefetch
location as `launchUrl`. The activation handler prevents native navigation only
when scripted popup creation succeeded; otherwise the same activation's anchor
proceeds while the armed connection binds it.

The scripted path is primary and PoC-qualified; the qualified mobile browsers
did not reject it. The real anchor is a hedge against an unqualified browser or
embedding policy returning `null`, not a claim that a launch target is known to
require it.

`proveUserIdentity()` navigates the retained connection to Prefetch using its
bare URL and a separate `URLSearchParams` fragment argument. `launchUrl` is
the equivalent browser URL for the native anchor, not a string passed into
`connection.navigate`. It waits for `PrefetchStarted`, then calls
`connection.navigateAway` with the frozen platform authorization destination
(and a separate fragment argument if that platform uses one), without
disclosing that URL to the Prefetch peer. With native-anchor fallback,
`@libid/popup` binds the anchor-created window while the Application's anchor performs the initial
navigation; ceremony observes only its typed messages. There is no popup
argument to proving and no mutable connection setter.

```ts
function activate(event: MouseEvent) {
  const anchor = event.currentTarget as HTMLAnchorElement
  const ceremonyId = crypto.randomUUID()
  const target = `libid-${ceremonyId}`
  const popupWindow = PopupWindow.open(target)
  const connection = PopupConnection.connect<Message>(popupWindow, {
    connectionId: ceremonyId,
    allowedPopupOrigins: [ccdpOrigin, new URL(redirectUri).origin],
  })
  const ceremony = ceremonies.new(
    connection,
    ceremonyId,
    ledgerId,
    platformId,
    operationDomain,
    transactionData,
  )

  anchor.href = ceremony.launchUrl
  anchor.target = target
  if (popupWindow.opened) event.preventDefault()
  void ceremony.proveUserIdentity()
}
```

Callback authenticates the Application, then navigates directly to Prover
with the captured OAuth query/fragment in a private structured fragment.
`proveUserIdentity()` receives no OAuth return. It accepts one fieldless
`ProverReady` and sends one `AppStartProver` containing the frozen platform,
version, client ID, redirect URI, nullable code verifier, and encoded `ledgerId`.

The selected Prover leaf validates the retained return against that request,
the CCDP version, and the authenticated connection's ceremony ID. A valid
OAuth denial sends `CancelCeremony`, making the client resolve a denied
`IdentityResult`. Malformed returns and technical failures use
`AbortCeremony` and reject. Only accepted OAuth proceeds to proof execution.
On proof delivery the client structurally validates the separate identity and
selected platform/version proof, adds the version and retained authorization
nonce to `OAuthProof`, and resolves an accepted `IdentityResult`. A locally
canceled ceremony ignores any later remote result.

The ceremony never closes its popup. The application composition owns whether
to retain, navigate, or close the window after any result, cancellation, or
failure; a wallet composition may therefore continue its own flow in the same
popup.

The Job is already committed before `proveUserIdentity()` and remains the
composition's current ceremony state while the call runs. Progress may update
its advisory projection, but no pre-proving authority CAS or ceremony callback
exists. The final composition-owned Job CAS is the authority boundary: if
cancellation, expiry, or another transition retired the Job, a late result
cannot commit.

`cancel()` is best-effort ceremony-work and connection cleanup and is called
only after the composition retires its Job. It does not close or navigate the
popup. Losing the application document loses the in-memory Ceremony and
therefore requires fresh OAuth, as already required by the
no-ceremony-recovery launch scope.

### OAuth Bridge configuration

The client fetches and validates the origin-controlled
[`CeremonyConfig`](oauth-bridge.md#public-configuration) once, then freezes
the chosen platform, version, client ID, redirect URI, and CCDP origin. CCDP
[resources](documents.md#documents-and-routes) never fetch it.

## Result and lifecycle

```ts
interface Identity<P extends PlatformId = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

interface GoogleProofV1 {
  identityProof: Uint8Array
  tokenExpiresAt: number        // exact signed exp
  signingKeyModulus: Uint8Array
}

interface XProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

interface GitHubProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

type OAuthProof<P extends PlatformId = PlatformId> = {
  [K in P]: {
    [V in SupportedCeremonyVersion<K>]: {
      platformCeremonyVersion: V
      authorizationNonce: Uint8Array   // exactly 32 bytes
      proof: ProofByPlatformVersion[K][V]
    }
  }[SupportedCeremonyVersion<K>]
}[P]

type IdentityResult<P extends PlatformId = PlatformId> =
  | {
      [K in P]: {
        status: 'accepted'
        identity: Identity<K>
        oauthProof: OAuthProof<K>
      }
    }[P]
  | { status: 'denied' }

```

The platform type selected in `CeremonyClient.new` flows through `Ceremony`,
`IdentityResult`, and `OAuthProof`. A literal platform input therefore returns
the corresponding `proof` type; a dynamic `PlatformId` returns the platform
proof union. The mapped unions preserve the relationship between
`identity.platformId`, `oauthProof.platformCeremonyVersion`, and the proof type.
A nested `identity.platformId` check alone does not narrow the sibling
`oauthProof` in TypeScript; dynamic callers use a platform/version result guard
when they need platform-specific fields. Adding a platform or version extends
the closed catalog, not `OAuthProof` or CCDP.

Callers do not supply a generic explicitly. A static platform literal flows
through `new` and `proveUserIdentity()`:

```ts
const ceremony = ceremonies.new(
  connection,
  jobId,
  ledgerId,
  'google',
  operationDomain,
  transactionData,
)

const result = await ceremony.proveUserIdentity()
if (result.status === 'accepted') {
  result.identity.userName             // Google's exact signed email
  result.oauthProof.proof.identityProof // GoogleProofV1
}
```

Wrappers preserve inference by carrying `P extends PlatformId`; widening either
input or return type to `PlatformId` intentionally widens the result union.

`PlatformCeremonyVersion` is an unsigned 16-bit integer selected by the ceremony client
from the versions advertised in ceremony configuration, never by the caller. It
versions one platform's complete ceremony semantics: authorization-digest
construction, OAuth request and return handling, platform proof construction,
and assembly of the final `OAuthProof`. It does not version a chain, Registry,
or verifier contract; multiple chain-specific Consumers may accept the same
ceremony output.
Together with `Identity.platformId`, the selected `PlatformCeremonyVersion`
identifies the proof shape; there is no independent proof or contract-verifier
version. Each current platform has only version `1`. A new ceremony version must add its own
version slice, proof type, and validator, even when it deliberately retains the
same fields. The caller cannot select a version directly.
`authorizationNonce` is exactly 32 cryptographically random bytes. For X and
GitHub the Ceremony Client derives the code verifier from the Authorization
Digest and that nonce, sends only the derived verifier to the prover, and
retains the nonce until the token exchange has completed. The accepted
`OAuthProof` then publishes `authorizationNonce` so the Platform Verifier can
reproduce the binding. Exact authorization and PKCE encoding are delegated to
the normative ceremony specification.

`OAuthProof<P>` contains only the internally selected ceremony version,
client-generated authorization nonce, and platform-specific `proof`.
`IdentityResult` carries `identity` beside it, not inside the platform proof.
`platformId` is already in `Identity`; `operationDomain` and `transactionData`
are caller-owned ceremony inputs and are not returned. Each version's
`types` leaf owns that proof type and structural validator. Each platform
retains its own proof type even when fields coincide. Proof-byte names describe
the statement: Google's `identityProof` proves its signed identity claims;
X/GitHub's `bearerLinkProof` links the hidden bearer in two attested sessions.

`Identity` is the common prover-extracted view. `oauthClientId` and `userId`
preserve the platform's exact identifier strings. `userName` is Google's signed
email, X's username, or GitHub's login, not a display name or normalized handle.
`platformId` must match the selected platform. No observation time, expiry,
signing key, digest, or proof bytes belong in this shared view.

[`NotaryAttestation`](notarization.md#internal-contract) contains the original
`attestedData` and `signature` bytes plus their complete `decoded` view. The
Prover attaches that view from its existing decoder; the Client does not
decode the bytes again. Signed evidence time remains in each attestation's
`decoded.createdAt`, not a second proof-level `metadataObservedAt` field.
The result types are client-safe; importing them does not import the Prover's
decoder or WASM.

`GoogleProofV1` names the circuit's semantic public values rather than exposing
bb.js's ordered field array. The Google adapter's pure
`buildGooglePublicInputs(authorizationDigest, identity, proof)` helper hashes and packs
those values from the separate identity and platform proof, including
`identity.oauthClientId`, `identity.userId`, and
`identity.userName`, into the circuit's exact 56-field verifier input only at the
verifier/transaction-encoding boundary. The Ceremony Client does not call it to
verify the proof. Google has no attestation from which the Platform Verifier
could recover these values, so they remain proof inputs. For X and GitHub,
the Platform Verifiers reconstruct the bearer commitments, client identifier,
identity, and evidence time from verified attestation bytes. Their separate
browser `identity` and attestation `decoded` fields are convenience views for
UI and diagnostics, not additional verifier inputs.

Neither `OAuthProof` nor its platform proof contains chain ID or Authorization
Digest: the Proof Verifier observes the former from its chain environment and
recomputes the latter. No proof record adds a verifier address, verification
key, caller-selected validity bound, or normalized handle. The composition
assembles ledger submission from its original operation inputs and the accepted
`IdentityResult`; the reduced `OAuthProof` alone is not a complete submission.
Ledger serialization omits the attestation `decoded` views and X/GitHub's
convenience `identity`; it passes the original signed bytes unchanged. Changing a convenience view
cannot change authoritative ledger identity or evidence time.

The Ceremony Client calls `validateProofMessage` with its retained platform and
version, returns the decoded `identity` separately, and constructs `OAuthProof`
from the typed platform proof, selected version, and retained authorization nonce.
Validation checks exact shapes, field types, bounds, the selected platform, and
the identity's OAuth client identifier against the frozen client; it does not
parse attestation bytes, derive identity, repeat prover-side evidence checks, recompute the retained
digest, or cryptographically verify the proof. Prover-side platform code owns
canonical evidence parsing and configured-client checks.
Neither endpoint performs a separate Google nonce-versus-expected-digest
comparison or local notary-signature verification. The Prover still parses the
nonce canonically, the Google circuit still verifies RS256 and binds that
nonce to its public input, and the notarization/platform code still performs
its documented structural, request-binding, and commitment/opening checks.
Early digest-mismatch and structurally valid attestation-forgery detection are
omitted; downstream verification must still reject them using the recomputed
authorization digest and trusted signing keys. The expected digest is not an
`AppStartProver` input.
`status: 'accepted'` means the Prover reported successful OAuth/proving and the
Client accepted the result shape, not that the Client authenticated its
contents. UI and diagnostics may use the extracted fields as unverified
information; only Ledger Verifier acceptance makes identity authoritative.

The live `Ceremony` privately retains its ID, copied operation inputs, selected
platform and ceremony version, authorization nonce and digest, OAuth client and
redirect, derived code verifier, and supplied popup connection. A restart creates a fresh Ceremony
with a fresh nonce, digest, and verifier. After proof acceptance, the Job may
store the accepted `IdentityResult` alongside its original operation inputs. Before
acceptance, no Job or IndexedDB index stores the authorization nonce or digest,
code verifier, OAuth-platform credential, or private witness. No separate OAuth-state
value or pre-proof checkpoint is ever persisted.

The ceremony receives no action kind, job revision, chain RPC, Registry client,
wallet key, threshold, fee, connector, transaction submitter, database,
`CryptoKey`, or arbitrary callback. Its output contains separate `Identity`
and `OAuthProof` but no live bearer credential, private witness, wallet signature, fee quote,
or transaction submission capability.

All records are exact-shape and bounds validated without coercion. Ceremony IDs are
lowercase RFC 4122 UUIDv4 values generated with `crypto.randomUUID()` and are
serialized as the suffix of `v1.<ceremonyId>` OAuth `state`. The code verifier is derived by the
normative PKCE construction. Derived hashes are exact 32-byte `Uint8Array`
values. Unknown fields, aliases, coercions, and
noncanonical encodings fail before use.

## Progress, cancellation, and recovery

```ts
type CeremonyStage =
  | 'authorization'
  | 'proof-generation'

interface PlatformStep {
  code: string
  label: string
  status: 'started' | 'completed' | 'failed'
  progress: number
}

interface CeremonyEvent {
  stage: CeremonyStage
  platformStep: PlatformStep | null
  timestamp: number
}
```

The application-side `Ceremony` client owns the common stage. It enters
`authorization` when `proveUserIdentity()` starts and `proof-generation`
immediately before it sends `AppStartProver` after `ProverReady`.
The latter includes Prover-side OAuth validation, platform steps, proof
delivery, and immediate `OAuthProof` assembly. There is no separate
`oauth-validation` stage: the client does not observe that internal boundary.
The client publishes these transitions from its own control flow; no callback
lifecycle message or platform-step inference changes the common stage.

Each platform-ceremony-version prover leaf owns its closed diagnostic-span
catalog and partial-order rules beside the code which performs it; it cannot
select a common stage. Spans may overlap, and the client otherwise does not
interpret that catalog. `label` is bounded package-owned display text for the
current code, and `progress` is a finite monotonic value in `[0, 1)` derived by
the prover from completed weighted leaf spans. It is advisory milestone
progress, not elapsed time or an estimated completion time. Neither
common-stage nor platform-step events contain operation inputs, outputs,
credentials, identities, witnesses, proofs, raw exceptions, or raw service
errors.

`CeremonyEvent` is advisory. The application may project it into broader Job
progress, but confirmation, submission, and finality remain outside this
package. [CCDP](protocol.md#4-prover-execution) defines authenticated
connection delivery ordering.

## Implementation guide

Owns one-time Bridge configuration, frozen ceremony construction and the one-shot
Application lifecycle over a caller-supplied `PopupConnection`.

- [Public configuration](oauth-bridge.md#public-configuration): Bridge response contract.
- [CCDP protocol](protocol.md): messages and ordering.

[config.ts](../src/client/config.ts) validates configuration; [ceremony.ts](../src/client/ceremony.ts) owns state
and handlers. Identity extraction stays in the platform Provers. Wallet operations,
submission and post-ceremony actions belong to the Application.

### Technical failure details

Remote technical failures reject with `CeremonyError`: `code` identifies the
failed subsystem or operation and `message` is a package-owned explanation.
Local original errors may be retained as standard `Error.cause`; remote errors
contain no raw cause. Explicit application cancellation still uses `AbortError`.
