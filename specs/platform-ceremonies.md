# Identity-platform ceremonies

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document is the normative owner of each platform's OAuth profile,
authenticated identity fields, evidence composition, proof-validity rule,
exchange service, and platform-specific failure behavior. The
[common ceremony rules](ceremony-common.md) own the Authorization Digest,
serialization, PKCE, transcript extraction, client binding, and evidence
time. The Consumer's protocol owns transaction dispatch and authorization.
The browser architecture owns browsing contexts, redirect transport,
interruption behavior, and application handoff.

Google returns a signed OIDC ID Token directly to the redirect fragment. X and
GitHub use the OAuth authorization-code flow and notarized transcripts of
authenticated platform API responses.

Terms are imported from
[common ceremony rules §2](ceremony-common.md#2-terminology).

## 2. Ceremony profiles

Each platform ceremony has an independently versioned immutable profile. Its
Platform Ceremony Version is carried in its Authorization Digest and in the
Submission Payload. Each platform section defines its own launch version. A
version covers the digest, OAuth construction, and platform-specific proof
statement, not any Consumer Chain's verifier implementation. A Consumer Chain
routes on its own Verifier Version (common §5.1).

A profile is selected by the pair `(identityPlatform,
platformCeremonyVersion)`. Each platform section defines its exact canonical
lowercase ASCII `identityPlatform`; the version is a separate integer and is
never appended to that string.

Each profile also fixes the attestation list of common REQ-COMMON-41 and the
digest-binding method of common REQ-COMMON-02C. Google verifies no attestation
and binds the digest as a public proof input; X and GitHub each verify two
attestations — a token or token-exchange session and an identity session — and
bind the digest through the revealed `code_verifier` of common
REQ-COMMON-15A.

- REQ-PLAT-01:
  The Canonical Runtime MUST select and retain one exact profile for the live
  ceremony. The Canonical Runtime MUST NOT substitute another profile after
  authorization starts. Necessity: changing profiles mid-ceremony would produce
  evidence the selected verifier cannot check.
- REQ-PLAT-01A (upholds SP-BIND-01):
  Each Platform Ceremony Version MUST identify one exact proof statement and
  set of semantic public inputs independently of any Platform Verifier artifact
  or Notary Service deployment. Before accepting that platform and version
  pair, the Verifier Governance Process MUST select a conforming Platform
  Verifier artifact and, for a TLSNotary profile, a compatible Notary Service.
  Necessity: chain artifacts implement the versioned ceremony boundary; they
  do not define it.
- REQ-PLAT-01B:
  The Canonical Runtime MUST identify a profile with the exact
  `(identityPlatform, platformCeremonyVersion)` pair its platform section
  defines. It MUST NOT append the version to `identityPlatform` or accept a
  presentation alias in its place. Necessity: every component that selects a
  profile must do so on one canonical pair. A Consumer Chain's Verifier
  Version selects an implementation of a profile, not the profile.
- REQ-PLAT-02:
  The Canonical Runtime MUST treat a profile as ineligible until the
  application's authenticated profile lists it and the generated deployment
  contains every fixed route it requires. Necessity: cross-component
  interoperability between the Canonical Runtime build and server deployment.
- REQ-PLAT-03 (upholds SP-CLIENT-01):
  The Canonical Runtime MUST derive the local identity fields exclusively from
  the Platform Profile's canonical source in the exact Submission it
  returns.
  Those fields are not an authority decision; only the Consumer's
  acceptance of that exact Submission is. For X and GitHub, the Canonical Runtime MUST parse the exact revealed identity-response bytes that the
  Platform Verifier extracts, using the same canonical extraction and
  normalization rules. The Canonical Runtime MUST reject a detached proof
  output, sidecar value, or caller value that supplies or overrides `userId`,
  handle, or `metadataObservedAt`.

This is a data-source invariant, not a browser-flow requirement. It defines
the identity fields returned to callers and used by any composition-owned UI;
it does not create a ceremony-owned confirmation page.

### 2.1 Canonical platform user identifiers

| Identity platform | Authenticated source | Canonical `userId` | Mutable handle |
|---|---|---|---|
| Google | signed ID-Token `sub` | its exact 1–255 case-sensitive ASCII bytes | normalized email |
| X | `/2/users/me.data.id` JSON string | canonical nonzero unsigned 64-bit decimal | normalized `username` |
| GitHub | `/user.id` JSON integer token | canonical nonzero unsigned 64-bit decimal | normalized `login` |

- REQ-PLAT-04:
  The Implementation MUST accept a Google `sub` of bytes `0x20` through `0x7e`
  only. The Implementation MUST reject empty, control, non-ASCII, and
  over-255-byte values. Necessity: identity compatibility across
  implementations.
- REQ-PLAT-05:
  The Implementation MUST NOT trim or case-convert a Google `sub`. Necessity:
  identity compatibility.
- REQ-PLAT-06:
  The Implementation MUST require an X or GitHub identifier to match
  `^[1-9][0-9]{0,19}$` with a numeric value at most `2^64 - 1`. Necessity:
  identity compatibility.
- REQ-PLAT-07:
  The Implementation MUST copy the GitHub raw JSON number token's decimal bytes
  as the string. The Implementation MUST NOT parse it through a floating-point
  number, accept exponent notation, or round it. Necessity: identity
  compatibility.
- REQ-PLAT-08:
  The Implementation MUST reject a quoted GitHub identifier, a numeric X
  identifier, a leading zero, a sign, a fraction, an exponent, and any
  normalization of a Google `sub`. Necessity: identity compatibility.

Conformance vectors:

| Platform | Authenticated input | `userId` |
|---|---|---|
| Google | `sub: "123456789012345678901"` | `123456789012345678901` |
| X | `"id":"2244994945"` | `2244994945` |
| GitHub | `"id":1` | `1` |

Email, audience, client identifier, X username, and GitHub login never
replace the immutable `userId`.

### 2.1a Handle normalization

Proof layers work with raw bytes; normalization is a consumption-time
derivation, layered strictly:

- REQ-PLAT-08A (upholds SP-BIND-01):
  The Proving Circuit and the Notary Service MUST NOT case-fold, trim, or
  otherwise transform identity bytes. The Consumer MUST receive the handle as
  the raw authenticated bytes of its platform source.
- REQ-PLAT-08B (upholds SP-BIND-01):
  The Consumer MUST derive the normalized handle from the
  proof-verified raw bytes on its own write path. The Consumer MUST
  NOT accept a caller-supplied normalized handle or pre-hashed handle key.
  Necessity: the handle arrives inside a proof; a caller supplying the
  derived key could name any handle it liked.
- REQ-PLAT-08C:
  A browser-side normalization exists only for display and local checks. No
  proof statement or Consumer behavior may rely on it. Necessity: a check
  running in software the prover chooses whether to run is not a defense.

Normalization applies these per-platform criteria: ASCII-only input with
disallowed bytes rejected; lowercasing; Google validates the value as an
email address and keeps its `@`; X and GitHub strip one leading `@`;
underscore is allowed on X and not on GitHub; hyphen is allowed on GitHub and
not on X, and never leading, trailing, or doubled; a per-platform maximum
length; an empty result is rejected. The exact byte-level algorithm is fixed
by the shared cross-language handle vector table this profile publishes
alongside the specification, which every implementation reproduces; that
table, not this prose, is the precision anchor. A profile that publishes no
such table is ineligible.

- TEST-PLAT-20 (exercises REQ-PLAT-08A, REQ-PLAT-08B, REQ-PLAT-08C):
  Every implementation reproduces the shared handle vector table byte for
  byte; a caller-supplied normalized handle or pre-hashed key is rejected;
  and identity bytes transformed before derivation by the Consumer
  fail conformance.

### 2.2 Metadata ordering and validity ceilings

Proof validity and mutable-metadata ordering use the authenticated times below.

| Identity platform | `metadataObservedAt` | `proofValidUntil` |
|---|---|---|
| Google | signed ID-Token `exp` | signed ID-Token `exp` |
| X | the token attestation's signed creation time | `metadataObservedAt + proofLifetime[x]` |
| GitHub | the token-exchange attestation's signed creation time | `metadataObservedAt + proofLifetime[github]` |

For X and GitHub, "timestamp" is the signed TLSNotary attestation creation
time. The token attestation is the one-time PKCE and Authorization Digest
binding, so it alone supplies evidence time: one signed timestamp anchors both metadata
ordering and proof validity, exactly as Google's single signed `exp` does.
The identity attestation opens the same bearer and carries the identity
fields; its own creation time is not an evidence-time input and does not
refresh the authorization. The named lifetimes are current
[protocol parameters](libid.md#protocol-parameters).

Google's signed `exp` already supplies the accepted one-hour ordering and
validity value. A Google proof also requires its signing modulus to remain in
the Platform Verifier's active set. The Authorization Digest carries no expiration.
`metadataObservedAt` is the monotone metadata watermark of common
REQ-COMMON-25A. Older evidence cannot regress stored metadata and does not
block an otherwise valid authority operation.

- REQ-PLAT-09 (upholds SP-FRESH-01):
  The Platform Verifier MUST reject an X or GitHub attestation timestamp more than
  `maxFutureAttestationSkew` ahead of Block Time.
- REQ-PLAT-09A (upholds SP-FRESH-01):
  The Platform Verifier MUST derive `metadataObservedAt` and
  `proofValidUntil` from the exact sources in the table above and from
  nothing else.

## 3. Google OIDC ceremony

```text
identityPlatform = "google"
platformCeremonyVersion = 1
```

Google uses direct authentication-only OIDC and has no server-side token
exchange. Identity evidence is the signed ID Token delivered in the redirect
fragment.

### 3.1 Authorization request

`GET https://accounts.google.com/o/oauth2/v2/auth`, serialized per
[common §6](ceremony-common.md#6-canonical-oauth-serialization):

| Order | Field | Exact value |
|---|---|---|
| 1 | `response_type` | `id_token` |
| 2 | `response_mode` | `fragment` |
| 3 | `client_id` | configured client identifier |
| 4 | `redirect_uri` | immutable redirect URI |
| 5 | `scope` | `openid email` |
| 6 | `state` | immutable one-use OAuth state |
| 7 | `nonce` | `BASE64URL_NOPAD(authorizationDigest)` |

The authorization request is plain browser navigation and is never
notarized; no proof semantics attach to any field above. The table is
operational guidance for obtaining a token whose signed claims satisfy
§3.2–§3.3. The signed ID Token is the only Google evidence.

- REQ-PLAT-10 (upholds SP-BIND-01):
  The Canonical Runtime MUST set `nonce` to the base64url encoding of the 32
  Authorization Digest bytes, not to hexadecimal text.
- REQ-PLAT-11 (upholds SP-DELIVERY-01):
  The Canonical Runtime MUST request only `response_type=id_token` with
  `response_mode=fragment`. The Canonical Runtime MUST NOT request an
  authorization code or access token. Necessity: the signed identity evidence
  reaches the local Redirect Runtime without introducing a confidential
  backend or bearer capability.
- REQ-PLAT-12 (upholds SP-DELIVERY-01):
  The Redirect Runtime MUST copy the bounded query and fragment into memory and
  clear both before storage or network access. The Canonical Runtime MUST require
  an empty query and a fragment carrying exactly one `state` plus exactly one
  `id_token` XOR `error`. The Canonical Runtime MUST reject duplicate, additional
  authoritative, mixed-transport, or malformed fields and MUST ignore
  diagnostic fields.
- REQ-PLAT-13 (upholds SP-DELIVERY-01):
  The Canonical Runtime MUST match `state` to exactly one live local ceremony
  and consume it once before accepting the ID Token. No server-side state or
  prepare request participates in this lookup.

Conformance vector, for the Authorization Digest of
[common §5](ceremony-common.md#5-authorization-digest):

```text
authorizationDigest = 0xb318fb559e16a179b853ed2853576cda16032d93b0839bb81a55135d334c0af5
Google nonce         = sxj7VZ4WoXm4U-0oU1ds2hYDLZOwg5u4GlUTXTNMCvU
```

### 3.2 Local token verification

- REQ-PLAT-14 (upholds SP-BIND-01):
  The Canonical Runtime MUST reject an ID Token whose `nonce` differs from the
  Authorization Digest it constructed.
- REQ-PLAT-15:
  The Canonical Runtime MUST reject a Google response carrying `code` or
  `access_token`. Necessity: neither artifact belongs to this
  authentication-only profile.

### 3.3 Proof statement

The Proving Circuit and Consumer enforce all of the following:

- REQ-PLAT-16 (upholds SP-CLIENT-01):
  The Proving Circuit MUST hash the exact ASCII
  `BASE64URL_NOPAD(header) || "." || BASE64URL_NOPAD(payload)` bytes with
  SHA-256. The Proving Circuit MUST verify the signature as
  RSASSA-PKCS1-v1_5 under the exact RSA modulus `n` and the profile-fixed
  exponent `e = 65537`. The Proving Circuit MUST decode the claims checked
  below from that signed payload, not from a detached copy.

The profile fixes RS256; the circuit performs no algorithm dispatch and does
not parse the protected header. A token signed under any other algorithm or
key simply fails the fixed verification relation. Algorithm-confusion attacks
require a verifier that dispatches on the header `alg`; none exists here.

- REQ-PLAT-16A (upholds SP-CLIENT-01):
  The Proving Circuit MUST expose the exact RSA modulus used for REQ-PLAT-16
  as a public proof input. Its internal field or limb representation belongs to
  the proving and verifier artifacts, not the Platform Profile.
  The Proving Circuit MUST NOT decide trusted-set membership or take the active
  set as an input. The Platform Verifier alone checks the modulus under
  REQ-PLAT-23. JWK decoding and canonical-encoding validation happen where a
  modulus is admitted to the trusted set, per REQ-PLAT-24; the JWK encoding
  appears in no signed artifact, so proving it would add nothing.
- REQ-PLAT-16B (upholds SP-BIND-01, SP-CLIENT-01, SP-FRESH-01):
  The Proving Circuit MUST expose exactly the following Google public inputs,
  each derived from the signed payload or verified signing key:

  | Public input | Authenticated source |
  |---|---|
  | Authorization Digest | signed `nonce`, decoded as exactly 32 bytes |
  | client-identifier digest | `SHA256` of the signed `aud` |
  | canonical `userId` | signed `sub` |
  | raw `email` bytes | signed `email`; the Consumer derives the normalized handle |
  | evidence timestamp | signed `exp`; used for both `metadataObservedAt` and `proofValidUntil` |
  | RSA modulus | exact `n` that verified the JWS; `e = 65537` is profile-fixed |

  The Proving Circuit MUST NOT expose a detached second representation of a
  claim. Proofs are over raw bytes; normalization, such as lowercasing the
  handle, is the Consumer's decision at consumption time.
- REQ-PLAT-17 (upholds SP-BIND-01):
  The Proving Circuit MUST prove the signed `iss` equals
  `https://accounts.google.com`.
- REQ-PLAT-18 (upholds SP-BIND-01):
  The Proving Circuit MUST prove `nonce` equals the Authorization Digest.
- REQ-PLAT-19 (upholds SP-CLIENT-01):
  The Proving Circuit MUST expose `SHA256` of the signed `aud` as the
  client-binding public input.
- REQ-PLAT-19A (upholds SP-CLIENT-01):
  The Platform Verifier MUST require `SHA256` of the `aud` bytes carried in
  the Submission to equal that public input. The Platform Verifier MUST return those bytes
  as the client identifier of common REQ-COMMON-16. Necessity: the digest authenticates the
  bytes without the circuit packing a variable-length string into public
  inputs, and the Consumer still receives the readable value. Admission stays
  permissionless per common REQ-COMMON-17C.
- REQ-PLAT-20:
  The Proving Circuit MUST prove `email_verified` is the boolean `true`.
  Necessity: an unverified email would let one account assert another party's
  address as its handle.
- REQ-PLAT-21 (upholds SP-BIND-01):
  The prover supplies the offset of each checked claim as a private input.
  The Proving Circuit MUST check the string claims `iss`, `sub`, `aud`,
  `nonce`, and `email` under common REQ-COMMON-19 and REQ-COMMON-19B. The
  Proving Circuit MUST check `exp` as a canonical unsigned JSON integer bounded
  by an unsigned 64-bit integer, and `email_verified` as the exact unquoted
  JSON boolean `true`,
  under common REQ-COMMON-19D.
  Duplicate-free top-level structure is the issuer's behavior under
  ASM-PROV-06; the circuit performs no search and no duplicate scan.
- REQ-PLAT-22 (upholds SP-FRESH-01):
  The Platform Verifier MUST reject a proof whose signed `exp` places
  `proofValidUntil` at or before Block Time.

The signing key is fetched from Google's JWKS endpoint as witness input.

- REQ-PLAT-23 (upholds SP-CLIENT-01):
  The Platform Verifier MUST reject a proof whose RSA modulus is absent from
  the Platform Verifier's active trusted Google modulus set.
- REQ-PLAT-24:
  The Verifier Governance Process MUST add a newly published Google signing
  modulus to the trusted set before Google signs with it in production.
  Necessity: Google rotates signing keys on the order of weekly, so every
  Google ceremony fails closed while an active modulus is untrusted.

## 4. Browser TLSNotary launch transport

Launch fixes X's `/2/oauth2/token` and `/2/users/me` sessions and GitHub's
`/user` session to the Proxy profile.

| Property | Proxy profile | Browser MPC profile |
|---|---|---|
| Platform connection | notary connects to the pinned platform endpoint | deployment module supplies an encrypted WebSocket-to-TCP bridge |
| Platform sees | notary egress | application redirect-origin egress |
| Deployment sees OAuth plaintext | no | no |
| Soundness | notary-to-platform path must not be adversarial | survives an adversarial byte bridge |
| Cost | lower bandwidth, latency, rounds | higher browser and deployment cost |

- REQ-PLAT-25 (upholds SP-EXCHANGE-01):
  The Implementation MUST discard every partial transcript and TLS state before
  retrying a notarized request.
- REQ-PLAT-26 (upholds SP-EXCHANGE-01):
  The Implementation MUST NOT use application-controlled platform egress in the
  launch profile, because the prover holds the session keys and
  prover-egress collusion could inject authenticated server-direction records.
- REQ-PLAT-27 (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST NOT let an application, user, request, browser
  probe, failure, or retry select Browser MPC or switch transport within a
  launch ceremony.
- REQ-PLAT-28 (upholds SP-DELIVERY-01):
  The Canonical Runtime MUST require the X or GitHub authorization redirect to
  carry an empty fragment and a query containing exactly one `state` plus
  exactly one `code` XOR `error`. The Canonical Runtime MUST reject duplicate,
  mixed-transport, additional
  authoritative, and malformed fields. The single accepted `code` is the code
  consumed at redirect ingress that REQ-PLAT-29 and REQ-PLAT-46 compare
  against.
- REQ-PLAT-28A (upholds SP-DELIVERY-01):
  The Canonical Runtime MUST match the redirect's `state` to exactly one live
  local ceremony and consume it once before starting the token request. No
  server-side state or prepare request participates in this lookup.
  Necessity: the redirect is the only point where the ceremony that requested
  the authorization can still be identified.

Browser MPC is a deferred protocol alternative. It may remove the
notary-to-platform path assumption and notary egress exposure, but it requires
qualification of browser bandwidth, latency, memory, battery,
WebSocket-to-TCP bridging, and mobile suspension. Adopting it requires a new
ceremony profile whenever it changes the proof statement, attestation format,
ceremony behavior, or security assumptions; it is not deployment configuration
under the X or GitHub profile.

## 5. X ceremony

```text
identityPlatform = "x"
platformCeremonyVersion = 1
```

X uses a public client with S256 PKCE and two browser-owned TLSNotary
sessions.

### 5.1 Authorization request

`GET https://x.com/i/oauth2/authorize`:

| Order | Field | Exact value |
|---|---|---|
| 1 | `response_type` | `code` |
| 2 | `client_id` | configured client identifier |
| 3 | `redirect_uri` | immutable redirect URI |
| 4 | `scope` | `tweet.read users.read` |
| 5 | `state` | immutable one-use OAuth state |
| 6 | `code_challenge` | PKCE challenge per common §7 |
| 7 | `code_challenge_method` | `S256` |

### 5.2 Token request

`POST https://api.x.com/2/oauth2/token`, media type
`application/x-www-form-urlencoded`, `Accept: application/json`:

| Order | Field | Exact value |
|---|---|---|
| 1 | `grant_type` | `authorization_code` |
| 2 | `client_id` | configured client identifier |
| 3 | `code` | consumed redirect code |
| 4 | `redirect_uri` | immutable redirect URI |
| 5 | `code_verifier` | PKCE verifier per common §7 |

- REQ-PLAT-29 (upholds SP-EXCHANGE-01):
  The Implementation MUST reveal the token request's `code` range. The
  Canonical Runtime MUST require that revealed serialized value to equal the
  canonical form serialization of the code consumed at redirect ingress,
  byte for byte, under common REQ-COMMON-07.
- REQ-PLAT-30 (upholds SP-BIND-01):
  The Proving Circuit MUST constrain the opened bearer range to nonempty
  printable ASCII of at most 4096 bytes. The carriage-return and line-feed
  exclusion of common REQ-COMMON-37 applies to this range, because the
  identity session sends it inside a header. Necessity: the range is opened
  to link two attestations, so it needs a bound and a charset; the circuit
  verifies no other property of the token response.

Per common §9, the token session reveals exactly these ranges; every other
byte stays behind a charset-constrained range commitment of the pinned
attestation format:

| Range | Revealed | Why |
|---|---|---|
| request method and path | yes | the Platform Verifier compares them with its profile constants |
| endpoint authority | not a range | the Notary Service authenticated the TLS server identity, and the Platform Verifier compares the attested authority against its pinned constant per common REQ-COMMON-21A |
| `grant_type` | yes | constant `authorization_code`; the Platform Verifier compares it byte for byte per REQ-PLAT-56 |
| `client_id` | yes | the Platform Verifier reads and returns it |
| `code` | yes | compared to the code consumed at redirect ingress |
| `redirect_uri` | yes | the Canonical Runtime compares its immutable profile; no chain or circuit value |
| `code_verifier` | yes | the Platform Verifier recomputes it from the digest and `authorizationNonce` per common REQ-COMMON-15A |
| attestation timestamp | not a range | the attestation's own signed creation time, which derives the authenticated validity ceiling per §2.2 |
| `"access_token":"` and the closing quote immediately around the bearer value | yes | anchor the committed bearer range as that field's value, per common REQ-COMMON-18A |
| bearer range | committed | a blinded commitment, opened only in circuit |
| everything else | no | headers, `scope`, `token_type`, other response fields |

Neither the authority nor the attestation timestamp is a transcript range.
The authority reaches the Platform Verifier as
the TLS server identity the Notary Service authenticated under common
REQ-COMMON-21, carried in the attested data: the transcript
holds the authority only in a `Host` header this table hides, and a revealed
`Host` header is prover-composed text that says nothing about which server
answered. The timestamp is the signed creation time of the attested data
itself, which is why common REQ-COMMON-25 can forbid inferring it from a
response header. The two delimiter reveals are what anchor the committed range in the
received direction, which would otherwise reveal no byte at all and leave that
range indistinguishable from a `refresh_token` value.

Those reveals and the in-circuit `code_verifier` opening of REQ-COMMON-15
reduce the hidden request surface, but revealing a range does not reject a form
delimiter inside it. The X profile therefore retains ASM-PROV-07 as a soundness
dependency.

- REQ-PLAT-29A (upholds SP-CLIENT-01):
  The Implementation MUST reveal the `client_id` range of the token request in
  the notarized session.
- REQ-PLAT-29B (upholds SP-CLIENT-01):
  The Platform Verifier MUST read the client identifier from that revealed
  range and return its exact bytes. The Proving Circuit MUST NOT expose a
  client identifier public input. Necessity: the attestation already
  authenticates those bytes, so a circuit copy would be a second
  representation of one fact.
- REQ-PLAT-29C (upholds SP-EXCHANGE-01):
  The Implementation MUST reveal the token request's `grant_type` and
  `redirect_uri` ranges in the notarized session, including in the
  attestation the Platform Verifier checks. The Canonical Runtime MUST
  reject a transcript whose revealed serialized `grant_type` or `redirect_uri`
  value differs from the canonical form serialization of its immutable
  deployment-profile value. Neither value is a circuit
  constraint or a public proof input, and neither is a value the Consumer
  reads; the Platform Verifier compares the revealed `grant_type` itself
  under REQ-PLAT-56. Revealing them narrows the body a prover can compose
  without being observed; it does
  not by itself exclude a duplicate field, which remains ASM-PROV-07. The
  Platform Verifier enforces the disclosure: an attestation hiding either
  range does not match the profile layout of common REQ-COMMON-17A and
  REQ-COMMON-18A and fails verification.
- REQ-PLAT-56 (upholds SP-EXCHANGE-01):
  The Platform Verifier MUST reject an X token attestation whose revealed
  `grant_type` differs from the exact ASCII bytes `authorization_code`.
  Necessity: the Canonical Runtime's comparison under REQ-PLAT-29C runs in
  software the prover chooses whether to run, and `grant_type` is the one
  revealed field that changes what X did with the request. A body sending
  `grant_type=refresh_token` while still carrying a `code`, a `redirect_uri`,
  and a digest-derived `code_verifier` is processed as a refresh: X ignores
  the fields that grant does not use, returns a fresh bearer, and every
  revealed range still checks out, so an application holding a user's refresh
  token could mint identity proofs at arbitrary addresses indefinitely from a
  single consent. The check is one byte comparison on the Consumer Chain and
  adds nothing to the Proving Circuit.
- REQ-PLAT-30A (upholds SP-EXCHANGE-01):
  The Implementation MUST commit the returned `access_token` range of the
  notarized token session as the attestation format's blinded hash
  commitment. The Implementation MUST keep the plaintext token bytes
  redacted.
- REQ-PLAT-57 (upholds SP-EXCHANGE-01):
  The Implementation MUST reveal the `"access_token":"` delimiter bytes
  immediately preceding that committed range and the closing quote byte
  immediately following it. The Platform Verifier MUST reject an X token
  attestation whose committed range is not framed by exactly those revealed
  bytes. Necessity: common REQ-COMMON-18A wants a revealed anchor on every
  hidden range, and a received direction revealing nothing at all leaves the
  committed range indistinguishable from a `refresh_token` value or any
  other substring the prover chose to commit.

### 5.3 Identity request

`GET https://api.x.com/2/users/me` with no query. The request carries
exactly four headers, in this order: `authorization: Bearer <access_token>`,
`accept: application/json`, `host: api.x.com`, and `connection: close`.

Per common §9, the identity session reveals exactly these request ranges;
the bearer value is the only committed request range, and every other
request byte is revealed:

| Range | Revealed | Why |
|---|---|---|
| request line and all request headers, except the bearer value | yes | the Platform Verifier runs the line-anchored uniqueness scan of common REQ-COMMON-39 over these bytes and frames the committed range per common REQ-COMMON-40 |
| bearer value of the `authorization` header | committed | a blinded commitment, opened only in circuit |

The two ranges account for the request's signed transcript length exactly,
with no gap and no overlap, per common REQ-COMMON-35 and REQ-COMMON-36, so
the request leaves no byte undisclosed and uncommitted.

The response direction reveals exactly these ranges; every other response
byte stays behind a range commitment of the pinned attestation format:

| Range | Revealed | Why |
|---|---|---|
| `"id":"`, the `data.id` value, and its closing quote | yes | the Platform Verifier extracts the canonical `userId` from these bytes per REQ-PLAT-31 |
| `"username":"`, the `data.username` value, and its closing quote | yes | the Platform Verifier extracts the raw handle bytes from these bytes per REQ-PLAT-31 |
| everything else | no | status line, headers, display name, and every other response field |

Each revealed range carries its own full delimiter, so the value the Platform Verifier
reads is that field's value rather than a substring of a neighboring
one. Every committed range of this direction is bounded by a revealed
delimiter on each side that faces one, and by the signed transcript boundary
of common REQ-COMMON-36 at the two ends, which is the anchoring common
REQ-COMMON-18A requires.

- REQ-PLAT-59 (upholds SP-BIND-01):
  The Implementation MUST reveal the full `"id":"` and `"username":"`
  delimiters, their values, and their closing quotes in the `/2/users/me`
  response. The Implementation MUST redact every other response byte behind
  a range commitment. Necessity: REQ-PLAT-31 reads both fields out of
  revealed response bytes, and a session revealing no response range at all
  leaves it nothing to read.
- REQ-PLAT-31 (upholds SP-BIND-01):
  The Platform Verifier MUST extract `id` and `username` from the revealed
  response bytes by their full `"field":"` delimiters, rejecting a transcript
  in which either delimiter matches at more than one position, per common
  REQ-COMMON-19A. Necessity: the response carries account-holder-influenced
  text, such as the display name, that can embed a lookalike field.
- REQ-PLAT-31A (upholds SP-BIND-01):
  The Canonical Runtime MUST derive the X `userId` and normalized handle from
  those same revealed `id` and `username` bytes, by the same algorithm
  REQ-PLAT-31 fixes. That derivation is the repeat common REQ-COMMON-19E
  permits, and the extraction of REQ-PLAT-31 is the authoritative one. The
  Proving Circuit MUST NOT expose a second independently supplied
  representation of either identity field.
- REQ-PLAT-32 (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST assert that one private bearer value opens the
  bearer commitment of the token attestation and the `Authorization` bearer
  commitment of the `/2/users/me` attestation. The two commitment values
  differ, because common REQ-COMMON-44 draws an independent blinder for each
  notarized session.
- REQ-PLAT-32A (upholds SP-EXCHANGE-01):
  The Implementation MUST commit the `Authorization` bearer range of the
  notarized identity session as the attestation format's blinded hash
  commitment. The Implementation MUST keep the plaintext token bytes
  redacted. Necessity: each notarized session carries its own blinder, so the
  same bearer commits to two different values. Nothing outside a proof can
  tell that they open to one bearer, which is the reason a circuit exists at
  all.

- REQ-PLAT-32B (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST expose exactly these two X public inputs:

  | Public input | Meaning |
  |---|---|
  | token bearer commitment | the commitment the Platform Verifier matches against the verified token attestation |
  | identity bearer commitment | the commitment the Platform Verifier matches against the verified `/users/me` attestation |

  The Proving Circuit MUST keep the bearer private. The Proving Circuit MUST
  NOT add an Authorization Digest, client identifier, timestamp, endpoint,
  `userId`, or handle public input.
- REQ-PLAT-32C (upholds SP-EXCHANGE-01):
  The Platform Verifier MUST require each bearer commitment public input to
  equal the
  corresponding commitment in the attestation it verified. Necessity: without
  this the circuit could prove a link between two attestations other than the
  ones submitted.

The circuit proves exactly one thing: one hidden bearer opens both
attestations' blinded commitments. Everything else is checked where it can be
seen — the Platform Verifier binds the Authorization Digest by recomputing
the verifier under common REQ-COMMON-15A, reads the client identifier,
evidence timestamp, request method, path, and identity fields from revealed
attestation bytes, and takes each session's authority from the TLS server
identity that session's attestation authenticates. The circuit carries no
copy of any of them, because a fact that can be checked in the open does not
belong in a proof.

- REQ-PLAT-33 (upholds SP-FRESH-01):
  The Canonical Runtime MUST complete the request direction of X's first
  notarized token session before X's 30-second authorization-code deadline.
  The deadline ends when X has received the complete token request; receiving
  or notarizing the response, running the identity session, proving, and proof
  delivery are outside it. The Canonical Runtime MUST abandon the ceremony if it
  cannot complete that request direction in time.

## 6. GitHub ceremony

```text
identityPlatform = "github"
platformCeremonyVersion = 1
```

GitHub Token Service: The deployment-owned confidential-client component that
performs the GitHub token exchange inside a notarized TLS session and returns
the bearer, its opening, and the resulting attestation through the semantic
interface of §6.3.

GitHub uses a confidential client, a deployment-owned token-exchange
TLSNotary session, and a browser-owned `/user` TLSNotary session. The
structure matches X exactly: two attestations, both verified by the Notary
Service, one
hidden bearer linking them, and one proof binding that link to the
Authorization Digest. The exchange runs server-side because the client is
confidential, which makes the GitHub Token Service the notarized party for
that session. It produces an attestation, not a proof.

### 6.1 Authorization request

`GET https://github.com/login/oauth/authorize`:

| Order | Field | Exact value |
|---|---|---|
| 1 | `client_id` | configured client identifier |
| 2 | `redirect_uri` | immutable redirect URI |
| 3 | `scope` | `read:user` |
| 4 | `state` | immutable one-use OAuth state |
| 5 | `code_challenge` | PKCE challenge per common §7 |
| 6 | `code_challenge_method` | `S256` |

- REQ-PLAT-34:
  The Canonical Runtime MUST request exactly `read:user`. Necessity: GitHub
  inherits previously granted scopes for the same OAuth application, so an
  omitted scope does not yield a known grant.

### 6.2 Token exchange

`POST https://github.com/login/oauth/access_token`, media type
`application/x-www-form-urlencoded`, `Accept: application/json`:

| Order | Field | Exact value |
|---|---|---|
| 1 | `client_id` | configured client identifier |
| 2 | `code` | consumed redirect code |
| 3 | `redirect_uri` | immutable redirect URI |
| 4 | `code_verifier` | PKCE verifier per common §7 |
| 5 | `client_secret` | compiled deployment secret; redacted, never revealed |

`client_secret` is ordered last per REQ-COMMON-22. It stays in the body
rather than an `Authorization: Basic` header because Basic encodes the client
identifier and the secret into one redacted value, which would make the
revealed `client_id` something other than the credential GitHub authenticated.

- REQ-PLAT-35 (upholds SP-EXCHANGE-01):
  The Deployment MUST configure a client secret containing neither `&` nor
  `=`. Necessity: the secret is redacted and no party proves its contents, so
  a secret carrying a form delimiter would make the deployment's own request
  decode as more fields than it lists. Verification: inspection of the
  configured credential.
- REQ-PLAT-35A (upholds SP-CLIENT-01):
  The Proving Circuit MUST NOT expose `client_secret`, or any value derived
  from it, as a public proof input.
- REQ-PLAT-35B (upholds SP-CLIENT-01):
  The Implementation MUST reveal the `client_id` range of the exchange request
  in the notarized session.
- REQ-PLAT-35C (upholds SP-CLIENT-01):
  The Platform Verifier MUST read the client identifier from that revealed
  range and return its exact bytes. The Proving Circuit MUST NOT expose a
  client identifier public input. Necessity: the attestation already
  authenticates those bytes, so a circuit copy would be a second
  representation of one fact.
- REQ-PLAT-36 (upholds SP-BIND-01):
  The Proving Circuit MUST constrain the opened bearer range to nonempty
  printable ASCII of at most 4096 bytes. The Proving Circuit MUST verify no
  other property of the exchange response. The carriage-return and
  line-feed exclusion of common REQ-COMMON-37 applies to this range,
  because the `/user` session sends it inside a header. Necessity:
  `token_type` and the granted `scope` are response schema, and nothing on
  the Consumer Chain acts on them; the Canonical Runtime MAY check them
  locally.

### 6.3 GitHub token service boundary

The Deployment exposes one GitHub Token Service to its isolated prover. This
specification defines the semantic call, not its endpoint or wire encoding:

```text
githubTokenExchange(
  authorizationCode,
  codeVerifier,
) -> {
  bearer,
  bearerOpening,
  tokenAttestation,
}
```

These identifiers name protocol values, not serialized field names. The
browser and deployment specifications own endpoint naming, transport framing,
serialization, parsing bounds, caller authentication, and cache policy. Those
choices MUST preserve the semantic interface and security requirements below.

- REQ-PLAT-37:
  The Canonical Runtime MUST invoke the GitHub Token Service with the exact
  authorization code consumed from the redirect and the exact PKCE verifier
  derived for that ceremony. The service MUST use those values as the `code`
  and `code_verifier` of the token request in §6.2 and MUST NOT substitute
  another value.
- REQ-PLAT-38:
  On success, the GitHub Token Service MUST return the exact bearer committed
  by the token-exchange attestation, the opening for that bearer commitment,
  and that attestation. All three values MUST come from the same notarized
  session. On failure, it MUST return no partial result.
- REQ-PLAT-54:
  The GitHub Token Service MUST return in `bearerOpening` the blinder that
  opens the committed bearer range of the attestation it returns in the same
  response. Necessity: the Proving Circuit opens that commitment under
  REQ-PLAT-52, and the blinder is prover-private material generated inside
  the notarized session this service alone ran, so a browser holding the
  attestation and the bearer can neither derive the blinder nor build the
  GitHub proof without it.
- REQ-PLAT-55 (upholds SP-CLIENT-01):
  The Canonical Runtime MUST treat `bearerOpening` as private witness
  material for the Proving Circuit. The Canonical Runtime MUST NOT place
  `bearerOpening` in a Submission. The Canonical Runtime MUST NOT publish it,
  log it, or transmit it anywhere outside the browser. Necessity: the opening
  and the commitment together reveal the committed bearer, so a published
  opening publishes the credential its commitment exists to hide.
- REQ-PLAT-41 (upholds SP-EXCHANGE-01):
  The GitHub Token Service MUST use only its compiled client identifier, client
  secret, redirect URI, token endpoint, and notary configuration. The GitHub
  Token Service MUST NOT accept a caller-selected action, job, client, redirect,
  endpoint, return URL, or operation.
- REQ-PLAT-42:
  The GitHub Token Service MUST persist no code, verifier, bearer, proof,
  result, or progress state. The GitHub Token Service MUST expose no polling or
  result route. Necessity: the service holds ceremony credentials, so retention
  creates a compromise target with no protocol purpose.
- REQ-PLAT-43:
  The deployment transport MUST make the GitHub Token Service callable only by
  its authenticated isolated prover boundary, not by an application frontend
  or unrelated origin. The browser and deployment specifications define the
  concrete enforcement mechanism.
- REQ-PLAT-43B:
  The GitHub Token Service MUST reject redirects. Necessity: a followed redirect
  would notarize a session other than the pinned token endpoint.

### 6.4 Disclosure and verification

The GitHub Token Service, which holds the client secret, runs the exchange
inside a notarized TLS session and returns the resulting attestation. The
`client_secret` range stays redacted behind that attestation's range
commitment, so the browser never receives the secret. The attestation is
verified by the compatible Notary Service selected for the GitHub profile, exactly
as the `/user` attestation is.

The token-exchange attestation reveals exactly the ranges needed to bind it to
the local ceremony and to the later `/user` attestation. The separately
returned `accessToken` and the `bearerOpening` of REQ-PLAT-54 are the only
additional response values. Both stay inside the browser: the opening is
witness material for the circuit, and REQ-PLAT-55 keeps it out of every
Submission and every published artifact.

| Range | Revealed | Why |
|---|---|---|
| `client_id` | yes | the Platform Verifier reads and returns it; the Canonical Runtime checks its profile |
| `code` | yes | the Canonical Runtime compares it to the code it consumed |
| `redirect_uri` | yes | the Canonical Runtime compares its immutable profile |
| `code_verifier` | yes | the Platform Verifier recomputes it from the digest and `authorizationNonce` per common REQ-COMMON-15A |
| `"access_token":"` and the closing quote immediately around the bearer value | yes | anchor the committed bearer range as that field's value, per common REQ-COMMON-18A |
| bearer range | committed | a blinded commitment, opened only in circuit to link this attestation to `/user` |
| attestation timestamp | not a range | the attestation's own signed creation time, which derives the authenticated validity ceiling per §2.2 |
| token endpoint authority | not a range | the Notary Service authenticated the TLS server identity, and the Platform Verifier compares the attested authority against its pinned constant per common REQ-COMMON-21A |
| token request method | yes | the Platform Verifier checks its profile method |
| token request path | yes | the Platform Verifier checks its profile path |
| `client_secret` | no | never revealed, per REQ-PLAT-35A |
| everything else | no | headers, status line, `scope`, `token_type`, other response fields |

Every unrevealed range stays behind the pinned attestation format's range
commitment. The delimiter row is what anchors the committed bearer range in
the received direction, which would otherwise carry no revealed byte and
leave that range indistinguishable from a `refresh_token` value. Neither the
authority nor the attestation timestamp is a transcript range at all. The
authority reaches the Platform Verifier
as the TLS server identity the Notary Service authenticated under common
REQ-COMMON-21, carried in the attested data, because the
transcript holds the authority only in a `Host` header this table hides and a
revealed `Host` header is prover-composed text that says nothing about which
server answered. The timestamp is the signed creation time of the attested
data itself, which is why common REQ-COMMON-25 can forbid inferring it from a
response header. Revealing more would widen exposure without adding a check.

- REQ-PLAT-43D (upholds SP-EXCHANGE-01):
  The GitHub Token Service MUST reveal no range outside the seven rows
  marked `yes` above. The GitHub Token Service MUST commit the bearer range
  rather than reveal it.
- REQ-PLAT-58 (upholds SP-EXCHANGE-01):
  The GitHub Token Service MUST reveal the `"access_token":"` delimiter
  bytes immediately preceding that committed range and the closing quote byte
  immediately following it. The Platform Verifier MUST reject a
  token-exchange attestation whose committed range is not framed by exactly
  those revealed bytes. Necessity: the exchange response reveals no other
  byte, so without this anchor nothing distinguishes the committed range from
  a `refresh_token` value, and the revealed bound common REQ-COMMON-18A wants
  on every hidden range is absent.
- REQ-PLAT-43E (upholds SP-CLIENT-01):
  The Proving Circuit MUST NOT expose the bearer, or any value from which the
  bearer can be recovered, as a public proof input. The bearer commitments
  are public inputs under REQ-PLAT-52A; they reveal nothing about
  the bearer and are what ties the circuit to the two verified attestations.

- REQ-PLAT-44 (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST verify the returned token-exchange attestation
  locally against the GitHub profile's pinned notary key and attestation
  format before using the bearer. Necessity: the browser checks what it got
  back before spending a `/user` session on it; the Notary Service decision
  the Consumer Chain relies on is separate.
- REQ-PLAT-45 (upholds SP-EXCHANGE-01):
  The GitHub Token Service MUST return an attestation carrying the
  configured notary's signature and revealing the token request's method and
  path. The Platform Verifier MUST compare those two revealed values with the
  GitHub profile. The Platform Verifier MUST compare the authority that
  attestation authenticates with the same profile, per common REQ-COMMON-21A.
  Necessity: the authority is never a revealed range,
  because the transcript carries it only in a prover-composed `Host` header.
- REQ-PLAT-46 (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST require the disclosed serialized `code` value to
  equal the canonical form serialization of the code it consumed at redirect
  ingress, byte for byte.
- REQ-PLAT-47 (upholds SP-CLIENT-01):
  The Canonical Runtime MUST require the disclosed `client_id` to equal its
  configured client. Common REQ-COMMON-16B makes those bytes identical before
  and after form serialization.
- REQ-PLAT-48 (upholds SP-BIND-01):
  The Canonical Runtime MUST require the disclosed `code_verifier` to equal the
  verifier it derived. Its base64url alphabet is byte-identical under form
  serialization.
- REQ-PLAT-48A (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST require the disclosed serialized `redirect_uri`
  value to equal the canonical form serialization of its immutable
  deployment-profile value.
- REQ-PLAT-49 (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST require the returned bearer, under the returned
  `bearerOpening`, to open the bearer commitment of the token-exchange
  attestation.
- REQ-PLAT-50 (upholds SP-EXCHANGE-01):
  The Canonical Runtime MUST discard the response and start no `/user` request
  when any check in REQ-PLAT-44 through REQ-PLAT-49 fails.

Verifying only arbitrary byte substrings is insufficient: a prover that
composes the request could otherwise witness one `code` or `code_verifier`
while GitHub consumes a duplicate. The layout tiling accounts for every
transcript byte, every body range other than the secret is revealed, and the
opened secret is delimiter-free per REQ-PLAT-35. These checks reduce hidden
surface but do not prove the decoded form grammar or reject duplicates inside
revealed values. The GitHub profile therefore retains ASM-PROV-07 as a soundness
dependency. The server-produced token-exchange attestation carries the
commitments while
keeping the client secret from the browser.

### 6.5 Identity request

`GET https://api.github.com/user` with no query. The request carries
exactly five headers, in this order:
`authorization: Bearer <access_token>`, `accept: application/vnd.github+json`,
`x-github-api-version: 2022-11-28`, `host: api.github.com`, and
`connection: close`.

Per common §9, the identity session reveals exactly these request ranges;
the bearer value is the only committed request range, and every other
request byte is revealed:

| Range | Revealed | Why |
|---|---|---|
| request line and all request headers, except the bearer value | yes | the Platform Verifier runs the line-anchored uniqueness scan of common REQ-COMMON-39 over these bytes and frames the committed range per common REQ-COMMON-40 |
| bearer value of the `authorization` header | committed | a blinded commitment, opened only in circuit |

The two ranges account for the request's signed transcript length exactly,
with no gap and no overlap, per common REQ-COMMON-35 and REQ-COMMON-36, so
the request leaves no byte undisclosed and uncommitted.

The response direction reveals exactly these ranges; every other response
byte stays behind a range commitment of the pinned attestation format:

| Range | Revealed | Why |
|---|---|---|
| `"id":`, the `id` integer token, and the structural byte after it, which is `,` or `}` | yes | the Platform Verifier extracts the canonical `userId` from these bytes per REQ-PLAT-51 |
| `"login":"`, the `login` value, and its closing quote | yes | the Platform Verifier extracts the raw handle bytes from these bytes per REQ-PLAT-51 |
| everything else | no | status line, headers, and every other response field |

Each revealed range carries its own full delimiter, so the value the Platform Verifier
reads is that field's value rather than a substring of a neighboring
one. Every committed range of this direction is bounded by a revealed
delimiter on each side that faces one, and by the signed transcript boundary
of common REQ-COMMON-36 at the two ends, which is the anchoring common
REQ-COMMON-18A requires.

- REQ-PLAT-60 (upholds SP-BIND-01):
  The Implementation MUST reveal the full `"id":` delimiter, its integer
  token, and the structural byte after it, together with the full
  `"login":"` delimiter, its value, and its closing quote, in the `/user`
  response. The Implementation MUST redact every other response byte behind
  a range commitment. Necessity: REQ-PLAT-51 reads both fields out of
  revealed response bytes, and a session revealing no response range at all
  leaves it nothing to read.
- REQ-PLAT-51 (upholds SP-BIND-01):
  The Platform Verifier MUST extract `id` and `login` from the revealed
  response bytes by their full field delimiters, rejecting a transcript in
  which either delimiter matches at more than one position, per common
  REQ-COMMON-19A. The Platform Verifier MUST reject a noncanonical `id`
  encoding. The GitHub profile fixes the structural byte following the
  `id` integer token, which common REQ-COMMON-19D leaves to the profile, as
  `,` or `}` and no other byte. The Platform Verifier MUST reject any other
  following byte. Necessity: the terminator is what proves the revealed digits
  are the whole number rather than a prefix of a longer one, and JSON member
  order does not guarantee which of the two closes it.
- REQ-PLAT-51A (upholds SP-BIND-01):
  The Canonical Runtime MUST derive the GitHub `userId` and normalized handle
  from those same revealed `id` and `login` bytes, by the same algorithm
  REQ-PLAT-51 fixes. That derivation is the repeat common REQ-COMMON-19E
  permits, and the extraction of REQ-PLAT-51 is the authoritative one. The
  Proving Circuit MUST NOT expose a second independently supplied
  representation of either identity field.
- REQ-PLAT-52 (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST assert that one private bearer value opens the
  bearer commitment of the token-exchange attestation and the
  `Authorization` bearer commitment of the `/user` attestation. The Platform Verifier MUST
  compare the method and path revealed in each attestation, and
  the authority each attestation authenticates, with the GitHub profile.

- REQ-PLAT-52A (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST expose exactly these two GitHub public inputs:

  | Public input | Meaning |
  |---|---|
  | token-exchange bearer commitment | the commitment the Platform Verifier matches against the verified token-exchange attestation |
  | identity bearer commitment | the commitment the Platform Verifier matches against the verified `/user` attestation |

  The Proving Circuit MUST NOT add an Authorization Digest, client identifier,
  timestamp, endpoint, `userId`, or handle public input. Necessity: the digest
  is bound by the Platform Verifier under common REQ-COMMON-15A, and the rest
  are revealed bytes it reads directly, so a circuit copy would be a second
  representation of a fact that already has one.
- REQ-PLAT-52B (upholds SP-EXCHANGE-01):
  The Platform Verifier MUST require each bearer commitment public input to
  equal the
  corresponding commitment in the attestation it verified. Necessity: without
  this the circuit could prove a link between two attestations other than the
  ones submitted.

Changing the pinned API version requires a new Platform Ceremony Version; it
is not mutable configuration. The granted scope is no proof property at all:
REQ-PLAT-36 leaves the exchange response unverified beyond the opened bearer
range, and the Canonical Runtime's local reading of `scope` and `token_type`
binds nothing on the Consumer Chain. The bearer is never disclosed by the
proof.

- REQ-PLAT-53:
  The GitHub Token Service MUST NOT promise idempotency or replay. The Canonical Runtime MUST start a fresh ceremony when GitHub consumed the code but no
  response reached it. Necessity: the exchange is a single-use, non-recoverable
  step.

## 7. Adding an identity platform

The Platform Profile for a new platform MUST define a stable platform
identifier and immutable
user-ID namespace; canonical handle normalization and authenticated
observation ordering; client portability or a bounded client family; exact
authorization and redirect transport; every authenticated request and
response field with its provenance; how the Authorization Digest is carried
through that platform's authorization; its authenticated client-binding source; an
authenticated proof-validity rule and parameter keys; its trust-root lifecycle;
browser and deployment data exposure, retry, interruption, and withholding
behavior; and conformance vectors.

## 8. Conformance

Roles: Canonical Runtime, GitHub Token Service, Proving Circuit,
Platform Verifier, Notary Service, Consumer.

- TEST-PLAT-01 (exercises REQ-PLAT-10, REQ-PLAT-18):
  The §3.1 nonce vector reproduces exactly, and a token carrying another nonce
  is rejected.
- TEST-PLAT-02 (exercises REQ-PLAT-04, REQ-PLAT-05, REQ-PLAT-06, REQ-PLAT-07, REQ-PLAT-08):
  The §2.1 identifier vectors reproduce, and each listed malformed identifier
  is rejected.
- TEST-PLAT-03 (exercises REQ-PLAT-11, REQ-PLAT-12):
  A Google authorization request not using the exact direct-ID-token fragment
  profile is rejected. A nonempty query, mixed query/fragment response, or
  fragment carrying duplicate `state`, both `id_token` and `error`, `code`, or
  `access_token` is rejected.
- TEST-PLAT-04 (exercises REQ-PLAT-13, REQ-PLAT-14):
  A fragment whose `state` has no unique live local ceremony, and an ID Token
  whose `nonce` is not the constructed digest, are rejected. No backend state
  lookup occurs.
- TEST-PLAT-05 (exercises REQ-PLAT-15):
  A Google response carrying an authorization code or access token is rejected,
  and the deployment contains no Google exchange route or client secret.
  Verification: inspection of emitted artifacts.
- TEST-PLAT-06 (exercises REQ-COMMON-19D, REQ-PLAT-16, REQ-PLAT-16A, REQ-PLAT-16B, REQ-PLAT-17, REQ-PLAT-19, REQ-PLAT-19A, REQ-PLAT-20, REQ-PLAT-21, REQ-PLAT-23):
  A token with a foreign issuer, foreign audience, `email_verified: false`, a
  quoted or non-boolean `email_verified`, a quoted, negative, fractional,
  exponent, leading-zero, or overflowing `exp`, or an untrusted signing
  modulus is rejected in each case. A token signed
  under any other algorithm or key fails the fixed verification relation.
  Header, payload, signature, or public-output substitution is rejected. A
  cryptographically valid proof under an inactive signing modulus passes
  circuit verification but is rejected by the Platform Verifier. An Submission
  whose supplied `aud` bytes do not hash to the audience public input is
  rejected, and an accepted one returns those exact bytes as the client
  identifier.
- TEST-PLAT-07 (exercises REQ-PLAT-22, REQ-PLAT-09, REQ-PLAT-09A):
  A proof at or after `proofValidUntil`, and a token-attestation creation time
  more than `maxFutureAttestationSkew` ahead of Block Time, are rejected. An
  X or GitHub identity-attestation timestamp changes neither
  `metadataObservedAt` nor `proofValidUntil`; Google uses its signed `exp`
  for both values.
- TEST-PLAT-08 (exercises REQ-PLAT-24):
  The trusted modulus set contains every modulus currently published at
  Google's JWKS endpoint, and every corresponding exponent is 65537.
- TEST-PLAT-09 (exercises REQ-PLAT-29, REQ-PLAT-46):
  A transcript whose disclosed `code` differs from the code consumed at
  redirect ingress is rejected on X and on GitHub. A code containing a
  form-reserved byte matches only its canonical serialized value range, never
  the unencoded bytes or a noncanonical alternative.
- TEST-PLAT-09A (exercises REQ-PLAT-29A, REQ-PLAT-29B):
  An X attestation that does not reveal the token request's `client_id` is
  rejected; a proof exposing a client identifier public input is rejected; and
  the identifier the Platform Verifier returns equals the revealed bytes.
- TEST-PLAT-09B (exercises REQ-PLAT-30A, REQ-PLAT-32A):
  An X transcript that reveals plaintext `access_token` bytes in either
  session, or omits the bearer hash commitment, is rejected.
- TEST-PLAT-09C (exercises REQ-PLAT-29C, REQ-PLAT-56):
  The Platform Verifier rejects an X attestation that hides the `grant_type`
  or `redirect_uri` range, and the Canonical Runtime rejects a revealed value
  differing from the canonical form serialization of its deployment profile.
  A redirect URI containing `:` and `/` passes in that encoded form and fails
  as literal unencoded bytes. The Platform Verifier rejects an
  attestation whose revealed `grant_type` is `refresh_token`, and one whose
  `grant_type` differs from `authorization_code` in any byte, even when every
  other revealed range and the proof itself check out.
- TEST-PLAT-10 (exercises REQ-PLAT-30, REQ-PLAT-31, REQ-PLAT-32, REQ-PLAT-36, REQ-PLAT-51, REQ-PLAT-52):
  An opened bearer range that is empty, over 4096 bytes, or outside printable
  ASCII fails to prove; a revealed identity response missing `id` or the
  handle field is rejected; and a proof whose two attestations commit
  different bearers is rejected. No proof statement covers `token_type` or the
  granted scope.
- TEST-PLAT-11 (exercises REQ-PLAT-33):
  The complete request direction of X's first notarized session reaches X
  before the authorization-code deadline in the success case; delaying its
  completion past the deadline abandons the ceremony, while delaying only the
  response or later proof work does not trigger that deadline.
- TEST-PLAT-12 (exercises REQ-PLAT-34, REQ-PLAT-35, REQ-PLAT-35A, REQ-PLAT-35B, REQ-PLAT-35C):
  An authorization request carrying a scope other than `read:user` is
  rejected; no public proof input derives from the client secret; an exchange
  attestation that does not reveal the `client_id` range is rejected; an
  accepted one returns those exact bytes as the client identifier; and the
  configured secret contains neither `&` nor `=`. Verification: inspection of
  the configured credential for the secret rule.
- TEST-PLAT-13 (exercises REQ-PLAT-37, REQ-PLAT-38):
  The service receives the exact redirect authorization code and ceremony
  verifier. A successful result returns the bearer, opening, and attestation
  from one notarized session; substitution, a mixed-session tuple, and a
  partial result on failure are rejected.
- TEST-PLAT-14 (exercises REQ-PLAT-41, REQ-PLAT-42, REQ-PLAT-43, REQ-PLAT-43B, REQ-PLAT-43D, REQ-PLAT-43E):
  A request selecting an endpoint, client, or return URL is rejected; no state
  survives the call; a caller outside the authenticated isolated-prover
  boundary is refused; a redirected token exchange is rejected; an attestation
  revealing a range outside the seven marked rows, or revealing the bearer
  range instead of committing it, is rejected; and no proof exposes the bearer
  or a value from which it can be recovered.
- TEST-PLAT-15 (exercises REQ-PLAT-44, REQ-PLAT-45, REQ-PLAT-47, REQ-PLAT-48, REQ-PLAT-48A, REQ-PLAT-49, REQ-PLAT-50):
  A token-exchange attestation with a bad notary signature, a foreign
  endpoint, a foreign client, a foreign `code_verifier`, a foreign serialized
  `redirect_uri`, or a bearer that does not
  open the commitment under the returned `bearerOpening` is discarded in each
  case, and no `/user` request starts.
- TEST-PLAT-15A (exercises REQ-PLAT-52, REQ-PLAT-52A, REQ-PLAT-52B):
  A GitHub proof whose bearer commitment public input differs from the
  commitment in either submitted attestation is rejected; substituting one
  attestation for another from a different ceremony is rejected; and the
  proof carries no bearer, code, verifier, redirect URI, or added identity,
  time, client, or endpoint public input.
- TEST-PLAT-15B (exercises REQ-PLAT-32B, REQ-PLAT-32C):
  An X proof whose bearer commitment public input differs from the commitment
  in the submitted attestation is rejected, and a proof carrying a client
  identifier, timestamp, endpoint, `userId`, or handle public input is
  rejected.
- TEST-PLAT-16 (exercises REQ-PLAT-53):
  A ceremony whose exchange response was lost restarts from authorization.
- TEST-PLAT-17 (exercises REQ-PLAT-01, REQ-PLAT-01A, REQ-PLAT-01B, REQ-PLAT-02, REQ-PLAT-03):
  The launch profile pairs are exactly `("google", 1)`, `("x", 1)`, and
  `("github", 1)`; a suffixed platform string is not one of those profiles. A
  live ceremony that substitutes a newer profile is rejected, an unlisted
  profile is ineligible, and the profile identifies the same proof statement
  and semantic public inputs across two chains using different conforming
  verifier artifacts. A destination chain does not support the pair without a
  conforming artifact or, for a TLSNotary profile, a compatible Notary Service.
  No local identity field originates outside proof public inputs and the exact
  revealed attestation bytes carried by its Submission. Only the Consumer's
  acceptance of that exact Submission makes the claim authoritative.
- TEST-PLAT-17A (exercises REQ-PLAT-03, REQ-PLAT-31A, REQ-PLAT-51A):
  Pair authenticated X or GitHub identity-response bytes for account B with a
  detached `userId`, handle, or metadata value for account A. The Canonical Runtime
  rejects the extra representation; without it, the Canonical Runtime and the
  Platform Verifier both derive account B byte for byte. Replacing the proof,
  attestation, platform, or version after deriving the local identity fields
  discards them and requires rederivation from the replacement Submission.
- TEST-PLAT-18 (exercises REQ-PLAT-25, REQ-PLAT-26, REQ-PLAT-27, REQ-PLAT-28, REQ-PLAT-28A):
  Launch uses Proxy mode, rejects application or request selection of Browser
  MPC, uses no application-controlled platform egress, and carries no partial
  transcript state into a retry. A nonempty fragment, mixed query/fragment
  response, or redirect carrying two `code` fields, two `state` fields, both
  `code` and `error`, or a malformed field is rejected
  before any token request starts, as is a redirect whose `state` matches no
  live local ceremony or a ceremony already consumed.
- TEST-PLAT-19 (exercises REQ-COMMON-32; supports ASM-PROV-07):
  Recurring integration probes send each profile-listed X and GitHub token
  request field twice, in both orders and using both literal and percent-encoded
  equivalent field names, and send the otherwise valid request under alternate
  media types. The production endpoint rejects every probe and issues no
  bearer.
- TEST-PLAT-21 (exercises REQ-PLAT-54, REQ-PLAT-55):
  A token-exchange response carrying a valid `bearerOpening` lets the browser
  open the committed bearer range and build the GitHub proof; a response
  omitting that field, or carrying an opening that does not open the
  attestation's bearer commitment, is discarded and no proof is built; and no
  Submission, log, or published artifact contains the opening. Verification:
  inspection of the Submission fields and the emitted artifacts for the
  disclosure rule.
- TEST-PLAT-22 (exercises REQ-PLAT-57, REQ-PLAT-58, REQ-PLAT-59, REQ-PLAT-60):
  An X token attestation and a GitHub token-exchange attestation whose
  committed bearer range is not framed by the revealed `"access_token":"`
  delimiter and closing quote are each rejected, including one committing a
  `refresh_token` value instead; and an X `/2/users/me` or GitHub `/user`
  attestation revealing no `id`, `username`, or `login` range, or revealing
  a value without its full delimiter, is rejected.

## 9. Security Considerations

This document enforces SP-BIND-01, SP-CLIENT-01, SP-EXCHANGE-01, and
SP-FRESH-01 for the launch platforms, under the assumptions of
[common §3](ceremony-common.md#3-assumptions).

Google is the only platform whose evidence is a bearer artifact: an ID Token
is complete evidence to whoever holds it. Its delivery is therefore
trust-bearing, and ASM-PROV-01 carries that weight. X and GitHub deliver an
authorization code, which is not evidence until redeemed, so a code alone
grants nothing.

Redemption differs by client type. GitHub requires the client secret
(ASM-PROV-04), so a code obtained by another party is inert. X is a public
client and requires no secret, so for X the registered redirect URI list is
the only barrier between an intercepted code and complete evidence; every
origin on that list is trust-bearing configuration, and an open redirect,
subdomain takeover, or script injection on any of them defeats it.

SP-BIND-01 rests on the platform enforcing the PKCE challenge match
(ASM-PROV-02) for X and GitHub, and on Google reflecting the requested nonce
into a signed token (ASM-PROV-05). ASM-PROV-02 is a live dependency on
platform behavior rather than a proven property. The Implementation claiming
conformance MUST run a recurring check that each platform still rejects a
mismatched `code_verifier`.

X and GitHub request-field uniqueness depends on their fixed token endpoints'
decoded-form behavior under ASM-PROV-07. Disclosure and delimiter constraints
reduce hidden request surface but do not replace that parser assumption.
TEST-PLAT-19 exercises it continuously; a failed probe makes the affected
profile ineligible for new ceremonies.

A malicious GitHub Token Service cannot rebind a ceremony to other
Authorized Transaction Data while ASM-PROV-07 holds, because the Authorization
Digest fixes that data before the platform is contacted and the service cannot
make GitHub redeem a `code_verifier` other than the one proven. Should
ASM-PROV-07 fail at GitHub's token endpoint, this is the party positioned to
exploit it: it legitimately holds the user's code and verifier. It can
withhold, and it can attempt to substitute a token obtained under a
separately arranged authorization; REQ-PLAT-46 rejects that substitution by
requiring the proven code to be the one this ceremony consumed. A proof
built outside the Canonical Runtime performs no such check, so a Submission
carrying it is bounded by the Transaction Author rule stated in
[common §12](ceremony-common.md#12-security-considerations).

The notary key is a trust root for X and GitHub evidence. Its compromise
mints fresh evidence until the key is removed, and does not revoke authority
already committed.

Google has no server-side token exchange. Its signed ID Token reaches the
redirect fragment, is cleared before
other work, and is bound to the local ceremony by `state`, signed `nonce`, and
signed `aud`. A deployment backend can withhold the static redirect document
but cannot substitute an ID Token through a server exchange that does not
exist.

Google's JWKS rotation makes the trusted modulus set a liveness dependency
(REQ-PLAT-24): every Google ceremony fails closed while Google signs with an
untrusted modulus.

## 10. References

Normative: [RFC6749], [RFC7636], [RFC7515], [RFC7517], [RFC7518], [RFC7519],
[RFC8017], [OIDC], [RFC8446].

Informative: [RFC9700], [TLSNotary-Proxy].
