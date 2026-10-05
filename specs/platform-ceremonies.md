---
title: Identity-platform ceremonies
sidebar:
  order: 3
---

# Identity-platform ceremonies

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document is the normative owner of each platform's OAuth profile,
authenticated identity fields, evidence composition, proof-validity rule,
token exchange, and platform-specific failure behavior. The
[common ceremony rules](ceremony-common.md) own the Authorization Digest,
serialization, PKCE, transcript extraction, client binding, and evidence
time. The Consumer's protocol owns transaction dispatch and authorization.
[CCDP](ccdp.md) owns browsing contexts, redirect transport, and document
handoff. Its Application and browser participants together implement the
Canonical Runtime. Callback captures and clears the return; Prover owns complete
platform-return parsing, canonical evidence decoding, request bindings, and
commitment/opening correlation. Application validates the delivered identity and
platform proof under the selected profile, including Google's public-input
consistency checks, and wraps it with retained authorization fields; it does
not repeat Prover's evidence extraction or perform cryptographic verification.
Ledger verification means the
Proof Verifier, Platform Verifier, and Notary Service checks before Consumer
acceptance, not browser generation or a locally accepted result.

Google returns a signed OIDC ID Token directly to the redirect fragment. X and
GitHub use the OAuth authorization-code flow and notarized transcripts of
authenticated platform API responses.

Terms are imported from
[common ceremony rules §2](ceremony-common.md#2-terminology).

## 2. Ceremony profiles

Each platform ceremony has an independently versioned immutable profile. Its
Platform Ceremony Version is carried in its Authorization Digest and in the
Submission Payload. Each platform section defines its own launch version. A
version covers the digest, OAuth construction, platform-specific proof
statement, and protocol parameter values, not any Consumer Chain's verifier
implementation. A Consumer Chain routes on its own Verifier Version (common
§5.1).

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
  The Application MUST treat a profile as ineligible unless its Bridge
  configuration enables that platform, the Distribution version list
  advertises that platform/version pair, and the Application implements it,
  under REQ-BRIDGE-03 and REQ-DIST-06. Necessity: independently deployed
  participants must support the selected profile.
- REQ-PLAT-03 (upholds SP-CLIENT-01):
  The Prover MUST derive the local identity fields exclusively from the
  Platform Profile's canonical sources in the evidence it returns: for X and
  GitHub, the revealed identity-response bytes; for a digest profile
  (§2.1b), the signed ID Token it verified under §3.2 whose digests the
  proof it returns carries.
  Those fields are not an authority decision; only the Consumer's
  acceptance of the resulting Submission is. For X and GitHub, the Prover
  MUST parse the exact revealed identity-response bytes that the
  Platform Verifier extracts, using the same canonical extraction rules.
  For a digest profile, the Prover MUST derive the local `userId` from the
  signed `sub` under REQ-PLAT-05A and the local handle from the signed
  `email`.
  The delivered handle remains raw; a local normalized display value follows
  REQ-PLAT-08C and does not replace it. The handle digest and handle key are
  over the normalized handle (REQ-PLAT-08M), not over the delivered bytes.
  The Prover MUST take `metadataObservedAt`
  from the profile's evidence-time source in §2.2, not from a detached identity value.
  The Prover MUST reject a caller-supplied or detached value used as an
  alternative source for `userId`, handle, or `metadataObservedAt`.
- REQ-PLAT-03A (upholds SP-PRIV-01):
  For a digest profile, the Canonical Runtime (its Application, which builds
  the Submission) MUST place the delivered handle in the Submission as its
  plaintext handle only when the user asks to disclose it. The Canonical
  Runtime MUST NOT place the `sub` in any Submission. Necessity: the Prover
  delivers the handle with every proof and builds no Submission, so the
  choice of sending it falls to the role that does. SP-PRIV-01 permits any
  handle a transaction carries, so this rule, not a Consumer check, keeps a
  Submission from carrying a handle the user did not choose to show.

This is a data-source invariant, not a browser-flow requirement. It defines
the identity fields returned to callers and used by any composition-owned UI;
it does not create a ceremony-owned confirmation page. CCDP's separate
`IdentityProof.identity` record transports Prover's derivation alongside the
proof; it is not another evidence source. Application validates that delivery's
structure and selected platform/client binding without repeating the evidence
extraction. Common REQ-COMMON-19E still binds the derivation to the exact evidence
used in the resulting Submission.

### 2.1 Canonical platform user identifiers

| Identity platform | Authenticated source | Canonical `userId` | Mutable handle |
|---|---|---|---|
| Google | signed ID-Token `sub` | the REQ-PLAT-05A digest of its exact 1–31 case-sensitive ASCII bytes | normalized email |
| X | `/2/users/me.data.id` JSON string | canonical nonzero unsigned 64-bit decimal | normalized `username` |
| GitHub | `/user.id` JSON integer token | canonical nonzero unsigned 64-bit decimal | normalized `login` |

- REQ-PLAT-04:
  The Implementation MUST accept a Google `sub` of bytes `0x20` through `0x7e`
  only, other than `"` and `\`. The Implementation MUST reject empty,
  control, non-ASCII, and over-31-byte values. The Implementation MUST apply
  both checks to the `sub` bytes exactly as they appear in the signed
  payload, before any JSON unescaping. Necessity: identity
  compatibility across implementations; 31 bytes is the Proving Circuit's
  buffer (REQ-PLAT-16C), which holds every `sub` Google issues only under
  ASM-PROV-05; a signed value holding a backslash is one whose JSON encoding
  escapes a byte, and an implementation that decodes the escape and one that
  reads the signed bytes would key it differently, so the signed bytes are
  the ones every implementation checks.
- REQ-PLAT-05:
  The Implementation MUST NOT trim or case-convert a Google `sub`. Necessity:
  identity compatibility.
- REQ-PLAT-05A:
  The Implementation MUST derive the Google `userId` as `0x` followed by the
  64 lowercase hexadecimal digits of
  `SHA256(UTF8("libid.google-user-id") || sub)`, over the exact signed `sub`
  bytes. Necessity: Google shows a `sub` only to the applications a user signs
  in to, so the Consumer Chain records this digest in its place, and every
  role must derive the same one. The tag separates the digest from a plain
  `SHA256(sub)` another system may publish.
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
| Google | `sub: "123456789012345678901"` | `0x20078023c9d4bf6bffc2580ec36446075d10c8453cecbe4f1cb3d326b2b35560` |
| X | `"id":"2244994945"` | `2244994945` |
| GitHub | `"id":1` | `1` |

Email, audience, client identifier, X username, and GitHub login never
replace the immutable `userId`.

### 2.1a Handle normalization

Proof layers work with raw bytes and normalization is a consumption-time
derivation, layered strictly, with one exception: in a digest profile
(§2.1b) the Proving Circuit applies that same normalization before it
digests, because the Consumer receives no bytes to normalize.

- REQ-PLAT-08A (upholds SP-BIND-01):
  The Notary Service MUST NOT case-fold, trim, or otherwise transform
  identity bytes. The Proving Circuit of a profile that exposes identity
  bytes MUST NOT transform them. The Consumer MUST receive the handle of
  such a profile as the raw authenticated bytes of its platform source. The
  Proving Circuit of a profile that exposes identity digests (§2.1b) MUST
  apply the profile's published normalization to the handle bytes it
  digests, refusing any input that normalization would trim rather than
  trimming it (REQ-PLAT-16C), and no other transform, so that the digest
  equals the one the Consumer derives from the normalized handle.
- REQ-PLAT-08B (upholds SP-BIND-01):
  The Consumer MUST derive the normalized handle from the proof-verified raw
  bytes on its own write path, or the handle key from the proof-verified
  handle digest where the profile exposes digests. The Consumer MUST NOT
  accept a caller-supplied pre-hashed handle key. The Consumer MUST
  normalize whatever handle bytes it receives, taking none as already
  normalized, and store and emit the normalized form. Where the profile exposes digests, the Consumer MAY accept
  caller-supplied handle bytes only under REQ-PLAT-08D or REQ-PLAT-08E,
  whose digest comparison or holding test binds them to a proof. Necessity: the
  handle arrives inside a proof; a caller supplying the derived key could
  name any handle it liked.
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
  byte; a caller-supplied pre-hashed key is rejected; a handle supplied
  already normalized is normalized again, and caller-supplied handle bytes
  are accepted only by the digest comparison of REQ-PLAT-08D or the holding
  test of REQ-PLAT-08E; and identity bytes transformed before derivation by
  the Consumer fail conformance. For a profile that exposes digests, the Proving Circuit
  reproduces the table's case-folding, character-set, and shape rows and
  refuses the inputs of its trimming rows, which a signed claim never
  carries.

### 2.1b Identity keys, names, and disclosure

The Consumer stores every binding under two keys. An identity's **identity
key** is derived from its identity platform and the keccak256 digest of its
canonical `userId`; its **handle key** is derived from its identity platform
and the platform's handle digest of its normalized handle (§2.1a,
REQ-PLAT-08M). Each key depends
on the value only through that inner digest, so a Consumer that receives
the digest derives the same key as one that receives the bytes. The
Consumer records for each key its **owner**, the Transaction Author that
last bound it, and its **watermark**, the `metadataObservedAt` of the
binding that last wrote it (common REQ-COMMON-25A). It also records two pairings: each identity key's current
handle key, and each handle key's current identity key. A Transaction
Author **holds** a handle on a platform while it owns that handle's key.

- REQ-PLAT-08H (upholds SP-BIND-01):
  The Consumer MUST derive identity keys and handle keys with two
  injective functions of the identity platform and the inner digest, fixed
  by its protocol, under which no identity key equals any handle key. The
  Consumer MUST NOT key a binding on anything else. Necessity: a handle that
  reads as a number and a `userId` that is that number must not share a key,
  and a key that depended on more than the inner digest could not be derived
  where only the digest is known. The EVM Consumer's construction is
  `keccak256(abi.encode(tag, platformId, digest))` with one fixed tag for
  each kind of key.
- REQ-PLAT-08M (upholds SP-BIND-01, SP-PRIV-01):
  A handle digest is the 32-byte digest of a normalized handle under the
  construction its Platform Profile fixes. A profile that exposes handle
  bytes MUST fix the `keccak256` of the normalized handle's bytes, which the
  Consumer computes itself. A digest profile MUST fix its construction in
  its proof statement, and the Consumer takes it from its configuration of
  the platform (REQ-PLAT-08L). The Google profile fixes
  `SHA256(UTF8("libid.google-handle") || email)` over the normalized
  `email` bytes. Every role that derives a handle digest, the Proving
  Circuit of a digest profile from the signed bytes and the Consumer from
  a carried handle, MUST use the platform's construction. Necessity: the
  handle digest is the inner digest of the handle key, so two
  constructions would key one handle twice; the Google circuit already
  computes SHA-256 for REQ-PLAT-05A, so its handle digest adds no second
  hash function, and the tag keeps the digest apart from a plain `SHA256`
  of the address that another system may publish.
- REQ-PLAT-08I (upholds SP-BIND-01, SP-FRESH-01):
  The Consumer MUST write the binding of an accepted Submission only when
  its `metadataObservedAt` is strictly newer than the watermark of the
  identity key and the watermark of the handle key it binds. On writing it,
  the Consumer MUST make the Transaction Author the owner of both keys, set
  both watermarks to that `metadataObservedAt`, and pair the keys in both
  directions. When it pairs an identity key with a handle key other than
  its previous one, the Consumer MUST clear the owner of the previous
  handle key if that handle key's current identity key is still this one,
  and MUST keep that key's watermark. The Consumer MUST NOT change an
  owner, a watermark, or a pairing on any other path. Necessity: an account
  that proves a new handle has stopped holding the old one, and leaving its
  owner in place would route to the renamed account whatever is sent to
  that handle; a handle another account has since proved is that
  account's, and is left alone. This retirement is what makes ownership of
  a handle key mean holding it now. The handle key's own watermark keeps
  evidence older than another account's proof of the handle from taking it
  back, and a retired key keeps its watermark so that evidence older than
  the binding it retired cannot claim it either.

A Transaction Author's **name** on a platform is the one handle the
Consumer stores for that author and platform to display, the analogue of an
ENS primary name kept per platform. An author holding several identities of
one platform still has one name there. A stored handle is a name only while
its author holds it, which the Consumer tests when the name is read; no
event clears a name when its handle moves.

A Submission **carries** its handle when the Consumer receives the handle's
bytes with it: on a profile that exposes handle bytes, always, as the
revealed handle bytes the Platform Verifier returns; on a digest profile,
when its plaintext handle field is present and nonempty, an empty field
carrying none. A disclosure call (REQ-PLAT-08E) carries the handle it
takes. A Submission **asks to publish** its handle when the Consumer call
that passes it requests publication. That request is an argument of the
Consumer's own call, beside the Submission, and is part of neither the
Submission Payload nor the Authorized Transaction Data: the name is the
Transaction Author's state, so the call the Consumer Chain authenticates
as that author is its authority, and no proof binds it.

- REQ-PLAT-08J (upholds SP-BIND-01):
  The Consumer MUST change a Transaction Author's name on a platform only
  through the paths this rule lists. On writing the binding of a Submission
  that carries the handle (REQ-PLAT-08I), the Consumer MUST store that
  handle as the author's name when the Submission asks to publish it. On
  writing such a binding, the Consumer MUST also store the handle when the
  stored name's handle key has as its current identity key the identity key
  the Submission binds. Where the stored name no longer normalizes under the
  platform's current rules (§2.1a), it has no handle key, and the Consumer
  MUST skip that second path, leaving the name unchanged, and MUST NOT
  reject the Submission for it. The Consumer MUST leave the name unchanged on
  accepting any other Submission, including one whose binding it does not
  write because its evidence is not strictly newer (common REQ-COMMON-25A).
  The Consumer MUST store the handle of an accepted disclosure call
  (REQ-PLAT-08E) as the caller's name. The Consumer MUST offer an author a
  withdrawal that clears its own name on a platform. Necessity: a name is
  the handle an author chose to show; a claim of another of its identities
  must not replace that choice, a rename of the named identity must not
  leave the old handle where the new one is known, a Submission carrying no
  handle has nothing to show, and evidence too old to bind must not restore
  a handle its identity has since left.
- REQ-PLAT-08K (upholds SP-BIND-01):
  The Consumer MUST answer a read of an author's name with the stored handle
  only while that handle, normalized under the platform's current rules
  (§2.1a), is admitted by them and the author holds it. The Consumer MUST
  answer that the author has no name otherwise. Necessity: a later claim of
  the same identity, another identity proving the handle, and a change of
  rules each move a handle without touching the name stored for it, so the
  test at read time is what keeps an author from displaying a handle it no
  longer holds.

A reader that mirrors names from the events of REQ-PLAT-08F applies the
same test; the stored string alone is not a name.

A digest profile is a Platform Profile whose Proving Circuit exposes the
handle as a digest (REQ-PLAT-08M) rather than bytes, beside a canonical
`userId` that is itself a digest of the platform's account identifier
(common §2); Google is one (§3.3). The Consumer knows a platform's profile is one from
its own configuration of that platform (REQ-PLAT-08L). The Consumer keys
every such identity on the digests, so an identity is resolvable by whoever
knows its handle or `userId` whether or not either was ever sent in
plaintext. What a digest profile adds is the choice of sending the handle.
The account identifier its `userId` digests, Google's `sub`, is never sent: nothing
the Consumer or a reader does needs it, and it is the one value that also
names the account at every other relying party.

Two facts about such an identity are kept apart. A handle is **disclosed**
once a Submission or disclosure call the Consumer accepted has carried it;
disclosure is history and nothing undoes it. A refused transaction leaves
no disclosure on record, although its calldata is public all the same
(common §12). A handle is **published** while it is its author's name under
REQ-PLAT-08K; publication is state.

- REQ-PLAT-08L (upholds SP-BIND-01, SP-PRIV-01):
  The Consumer MUST record, in its configuration of each platform and beside
  that platform's normalization, whether the platform's profile is a digest
  profile and, for a digest profile, the handle-digest construction it
  fixes (REQ-PLAT-08M). These are facts of the platform, not of a Platform
  Ceremony Version: every Platform Ceremony Version of one platform MUST
  share its normalization, its digest-profile flag, and its handle-digest
  construction. The Consumer MUST reject a Submission whose Platform
  Verifier result returns a handle digest on a platform not recorded as a
  digest profile, or returns verified handle bytes and no handle digest on
  one that is. The unverified handle a digest-profile result passes through
  beside its handle digest (common REQ-COMMON-05E) is not verified handle
  bytes. Necessity: every version of a platform binds into the same keys,
  so two versions that normalized, hashed, or exposed the handle
  differently would key one handle twice; the disclosure call and the
  freeze of REQ-PLAT-08G apply before any Submission of the platform
  exists, so the Consumer needs these facts from configuration, and
  checking every result against them keeps configuration and verifier from
  disagreeing.
- REQ-PLAT-08D (upholds SP-BIND-01, SP-PRIV-01):
  For a digest profile, the Consumer MUST derive the identity's keys from the
  canonical `userId` and the handle digest the Platform Verifier returns, in
  every Submission. Where a Submission carries the plaintext handle, the
  Consumer MUST normalize it under §2.1a. The Consumer MUST reject such a
  Submission unless the REQ-PLAT-08M digest of the normalized handle equals
  the handle digest. The Consumer MUST reject a Submission that asks to publish a name
  and carries no handle. Necessity: the plaintext handle arrives unverified
  and only the digest comparison ties it to the proof, and a request to
  publish with no handle asks for a name the Consumer has nothing to store
  for.
- REQ-PLAT-08E (upholds SP-BIND-01):
  For a digest profile, the Consumer MUST offer a disclosure call that
  takes a platform and a plaintext handle. The Consumer MUST normalize the
  handle under §2.1a and derive its handle key. The Consumer MUST accept the
  call only when the caller holds that handle. The Consumer MUST NOT require
  a new proof or the `userId` for a disclosure. Necessity: the handle's
  preimage is the evidence and ownership of its key the authority. A handle
  a later claim of the same account renamed away from has lost its owner to
  retirement (REQ-PLAT-08I), so the one test refuses it, while a handle one
  of the caller's identities took from another of them is held by the caller
  and may be shown. A refused call protects the display, not the handle: its
  calldata is public whether or not the Consumer accepts it.
- REQ-PLAT-08F (upholds SP-PRIV-01):
  The Consumer MUST state in every binding event whether the event carries
  the handle. The Consumer MUST state in every binding event whether the
  Submission stored the Transaction Author's name. The Consumer MUST emit an
  event for every accepted disclosure call and every withdrawal. The
  Consumer MUST put the normalized handle in the event of every accepted
  Submission that carried it and of every accepted disclosure call. The
  Consumer MUST NOT put a handle in any other event of a digest profile. The
  Consumer MUST NOT put the `sub` of a digest profile in any event.
  Necessity: an event that carried a handle is public for good, and a reader
  mirrors stored names only if the events say when one was stored, cleared,
  or left alone. A Submission without the handle after a disclosure leaves
  the handle disclosed, the name as it was, and its own event without the
  handle.
- REQ-PLAT-08G (upholds SP-BIND-01):
  For a digest profile, the Consumer MUST normalize the platform's handles
  with the handle table the profile publishes (§2.1a), whose case-folding,
  character-set, and shape rows the Proving Circuit reproduces
  (TEST-PLAT-20). Once it has bound any identity of a platform, the
  Consumer MUST refuse a change to whether that platform is a digest
  profile, and, for a digest profile, a change to its normalization or its
  handle-digest construction. Necessity: the Consumer holds only digests,
  so it cannot re-key a binding under new rules; a disclosed handle
  normalized or hashed other than as the circuit does stops hashing to its
  own key; and changing the flag changes which construction every handle
  key of the platform is derived with.
- TEST-PLAT-20A (exercises REQ-PLAT-03, REQ-PLAT-03A, REQ-PLAT-08D, REQ-PLAT-08E, REQ-PLAT-08F, REQ-PLAT-08G, REQ-PLAT-08L):
  The same Google account submitted with and without its handle lands on
  the same two keys. A Submission without the handle, made with
  recognizable test values, carries neither the email nor the `sub` in its
  decoded payload or its decoded events, and a Submission with the handle
  carries no `sub` in either. A Submission with an empty handle field is
  accepted as one carrying no handle. A Submission is rejected when its
  handle does not hash to the handle digest, and when it asks to publish a
  name without the handle. A disclosure call is rejected for a handle
  retired by a later claim of the same account and from a caller that does
  not hold the handle, and accepted for a handle another identity of the
  same caller took over; a disclosure of a held handle publishes it, and its
  event carries the normalized handle. A Submission without the handle after
  a disclosure leaves the binding resolvable by its handle, the name as it
  was, and its event without the handle. The Prover delivers the raw signed
  `email` as the handle and the REQ-PLAT-05A digest as the `userId`; the
  Application places that `email` in a Submission only when the user asks
  to disclose it, and places no `sub` in any. A change to Google's handle normalization is refused once a
  Google identity is bound, as is a change to its handle-digest
  construction or to its digest-profile flag. A platform configured as a
  digest profile rejects a verifier result carrying verified handle bytes
  and no handle digest, and accepts one carrying the handle digest beside
  an unverified carried handle; a platform configured otherwise rejects a
  result carrying a handle digest.
- TEST-PLAT-20B (exercises REQ-PLAT-08H, REQ-PLAT-08I, REQ-PLAT-08J, REQ-PLAT-08K):
  A numeric handle and a `userId` of the same digits land on different keys.
  An identity that proves a new handle leaves its old handle without an
  owner, unless another identity proved that handle meanwhile, which keeps
  it. For a wallet holding identities A and B of one platform with A's
  handle as its name, a claim of B with or without the handle and without
  asking to publish leaves the name; a claim of A under a new handle carrying
  it stores the new handle; a claim of A under a new handle without carrying
  it leaves the old handle stored and the name read as none; a claim of A
  under its current handle without carrying it leaves the name read as that
  handle; a claim asking to publish stores
  its handle. The name reads as none once another wallet proves the handle
  and once the platform's rules stop admitting it, and a withdrawal clears
  it. After A renames from handle H, a Submission of A under H whose
  evidence is not strictly newer than the binding, carrying H and asking to
  publish, binds nothing, whether the Consumer rejects it or completes
  another effect, and leaves the name unchanged. When identity A proves H
  at 100 and identity B proves H at 200, a Submission of A proving H at 150
  binds nothing, although 150 is newer than A's own watermark. When A
  proves H at 100 and then H2 at 300, H keeps its watermark of 100: another
  identity proving H at 50 binds nothing. A claim of A under a new handle
  while A's stored name no longer normalizes under the current rules is
  accepted and leaves that name stored. On X or GitHub, a
  claim asking to publish stores the revealed handle. Each binding event
  states whether it stored the name.

### 2.2 Metadata ordering and validity ceilings

Proof validity and mutable-metadata ordering use the authenticated times below.

| Identity platform | `metadataObservedAt` | `proofValidUntil` |
|---|---|---|
| Google | signed ID-Token `exp` | signed ID-Token `exp` |
| X | the token attestation's signed creation time | `metadataObservedAt + proofLifetime` |
| GitHub | the token-exchange attestation's signed creation time | `metadataObservedAt + proofLifetime` |

For X and GitHub, "timestamp" is the signed TLSNotary attestation creation
time. The token attestation is the one-time PKCE and Authorization Digest
binding, so it alone supplies evidence time: one signed timestamp anchors both metadata
ordering and proof validity, exactly as Google's single signed `exp` does.
The identity attestation opens the same bearer and carries the identity
fields; its own creation time is not an evidence-time input and does not
refresh the authorization. `proofLifetime` and `maxFutureAttestationSkew` are
the [protocol parameters](libid.md#protocol-parameters) each profile fixes.

Google's signed `exp` already supplies the accepted one-hour ordering and
validity value. A Google proof also requires its signing modulus to remain in
the Platform Verifier's active set. The Authorization Digest carries no expiration.
`metadataObservedAt` is the monotone metadata watermark of common
REQ-COMMON-25A. Older evidence cannot regress stored metadata and does not
block an otherwise valid authority operation.

- REQ-PLAT-09 (upholds SP-FRESH-01):
  The Platform Verifier MUST reject an X or GitHub attestation timestamp more than
  its profile's `maxFutureAttestationSkew` ahead of Block Time.
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
  The Callback MUST copy the bounded query and fragment into memory and
  clear both before storage or network access. The Prover MUST require
  an empty query and a fragment carrying exactly one `state` plus exactly one
  `id_token` XOR `error`. The Prover MUST reject duplicate, additional
  authoritative, mixed-transport, or malformed fields and MUST ignore
  diagnostic fields.
- REQ-PLAT-13 (upholds SP-DELIVERY-01):
  The Prover MUST match `state` to its bound live ceremony and accept that
  return only once before using the ID Token. No server-side state, prepare
  request, or application-wide ceremony lookup participates in this check.

Conformance vector, for the Authorization Digest of
[common §5](ceremony-common.md#5-authorization-digest):

```text
authorizationDigest = 0xb318fb559e16a179b853ed2853576cda16032d93b0839bb81a55135d334c0af5
Google nonce         = sxj7VZ4WoXm4U-0oU1ds2hYDLZOwg5u4GlUTXTNMCvU
```

### 3.2 Browser token validation

- REQ-PLAT-14 (upholds SP-BIND-01):
  The Prover MUST parse the token's `nonce` as canonical unpadded base64url
  encoding of exactly 32 bytes and use those bytes as the candidate
  Authorization Digest public input to the circuit. The expected digest
  remains Application-side and is not an additional Prover input; Prover
  performs no nonce-versus-expected-digest comparison. REQ-PLAT-16 and
  REQ-PLAT-18 bind the candidate to
  the signed token; common REQ-COMMON-02 and REQ-COMMON-02A bind the proof to
  the authorization that the Consumer is asked to accept.
- REQ-PLAT-14A (upholds SP-BIND-01, SP-CLIENT-01):
  Before delivery, the Prover MUST require the generated proof's public inputs
  to equal the projection of its parsed token claims and selected signing
  modulus under REQ-PLAT-16B, using the selected artifact's field encoding.
- REQ-PLAT-14B (upholds SP-BIND-01, SP-CLIENT-01):
  Before accepting a Google result, the Application MUST require its delivered
  public inputs to equal the projection of the retained Authorization Digest,
  validated identity fields, token expiry, and signing modulus under
  REQ-PLAT-16B, using the same artifact encoding. This checks result consistency,
  not the proof's cryptographic validity or the modulus's trusted-set membership.
  It requires neither the ID Token nor a new `ProveIdentity` field.
- REQ-PLAT-15:
  The Prover MUST reject a Google response carrying `code` or
  `access_token`. Necessity: neither artifact belongs to this
  authentication-only profile.

### 3.3 Proof statement

A profile is implementable only when its exact proving artifacts are
published ([libID](libid.md#system-model-and-specification-ownership)). No
published libid-circuits release enforces this statement yet: the
`oidc-google` circuit of v0.6.0 exposes the `email` bytes as a public
input, normalizes nothing, and admits a `\` in the `sub`. Google version 1
is implementable once a release that enforces REQ-PLAT-16B and REQ-PLAT-16C
publishes its artifacts.

The Proving Circuit and Consumer enforce all of the following:

- REQ-PLAT-16 (upholds SP-CLIENT-01):
  The Proving Circuit MUST hash the exact ASCII
  `BASE64URL_NOPAD(header) || "." || BASE64URL_NOPAD(payload)` bytes with
  SHA-256. The Proving Circuit MUST verify the signature as
  RSASSA-PKCS1-v1_5 under the exact RSA modulus `n` and the profile-fixed
  exponent `e = 65537`. The Proving Circuit MUST decode the claims checked
  below from that signed payload, not from a detached copy.

The profile fixes RS256; the circuit performs no algorithm dispatch and does
not parse the protected header. A signature that does not satisfy this fixed
relation under the supplied modulus fails in circuit. A valid signature under
an untrusted modulus can satisfy the circuit but fails REQ-PLAT-23 downstream.
Algorithm-confusion attacks require a verifier that dispatches on the header
`alg`; none exists here.

- REQ-PLAT-16A (upholds SP-CLIENT-01):
  The Proving Circuit MUST expose the exact RSA modulus used for REQ-PLAT-16
  as a public proof input. Its internal field or limb representation belongs to
  the proving and verifier artifacts, not the Platform Profile.
  The Proving Circuit MUST NOT decide trusted-set membership or take the active
  set as an input. The Platform Verifier alone checks the modulus under
  REQ-PLAT-23. JWK decoding and canonical-encoding validation happen where a
  modulus is admitted to the trusted set, per REQ-PLAT-24; the JWK encoding
  appears in no signed artifact, so proving it would add nothing.
- REQ-PLAT-16B (upholds SP-BIND-01, SP-CLIENT-01, SP-FRESH-01, SP-PRIV-01):
  The Proving Circuit MUST expose exactly the following Google public inputs,
  each derived from the signed payload or verified signing key:

  | Public input | Authenticated source |
  |---|---|
  | Authorization Digest | signed `nonce`, decoded as exactly 32 bytes |
  | client-identifier digest | `SHA256` of the signed `aud` |
  | canonical `userId` digest | signed `sub`, hashed per REQ-PLAT-05A |
  | handle digest | REQ-PLAT-08M digest of the signed `email` after the normalization of §2.1a (REQ-PLAT-16C) |
  | evidence timestamp | signed `exp`; used for both `metadataObservedAt` and `proofValidUntil` |
  | RSA modulus | exact `n` that verified the JWS; `e = 65537` is profile-fixed |

  The Proving Circuit MUST NOT expose a detached second representation of a
  claim. The handle digest is the inner digest of the handle key (§2.1b),
  so a claim that carries its handle and one that does not key the same
  binding.
- REQ-PLAT-16C (upholds SP-BIND-01, SP-PRIV-01):
  The Proving Circuit MUST NOT expose the signed `sub` or `email` in any
  public input. The Proving Circuit MUST reject a `sub` that REQ-PLAT-04
  rejects, and MUST hash exactly the signed `sub` bytes under REQ-PLAT-05A.
  The Proving Circuit MUST admit an `email` only when the normalization of
  §2.1a admits it, MUST refuse an `email` that normalization would trim, and
  MUST digest exactly the normalized `email` bytes. The Proving Circuit MUST
  fail to prove, rather than truncate, a `sub` longer than 31 bytes or an
  `email` longer than 62 bytes; these are the Google profile's buffer
  lengths, and 62 is the handle rules' own maximum. Neither the `sub` nor
  the `email` the circuit digests holds an escaped byte: every JSON escape
  begins with `\`, which the `sub` rule refuses and the `email` alphabet
  does not contain. Necessity:
  REQ-PLAT-05A keeps the `sub` off the Consumer Chain and this profile keeps
  the `email` off it unless a transaction carries it, which leaves the
  Proving Circuit the only role that sees their bytes, and a verifier that
  receives a digest inspects nothing.
- REQ-PLAT-16D (upholds SP-BIND-01, SP-PRIV-01):
  The Platform Verifier MUST return the canonical `userId` and the handle
  digest as the fields of common REQ-COMMON-05E. Where the Submission
  carries the plaintext `email`, the Platform Verifier MUST pass those bytes
  to the Consumer unchanged and unchecked, as the unverified handle of
  REQ-COMMON-05E. An empty `email` field carries no handle (§2.1b). The
  Google Submission Payload MUST carry no plaintext `sub`. The Platform
  Verifier MUST NOT emit or store the `email`. The Platform
  Verifier MUST NOT derive a normalized handle or a key from the `email`;
  the check that it hashes to the handle digest is the Consumer's under
  REQ-PLAT-08D, because it needs the normalization of §2.1a. Necessity: one
  party owns the equality, and it is the one that owns the normalization.
- REQ-PLAT-17 (upholds SP-BIND-01):
  The Proving Circuit MUST prove the signed `iss` equals
  `https://accounts.google.com`.
- REQ-PLAT-18 (upholds SP-BIND-01):
  The Proving Circuit MUST bind the signed `nonce` to the exact canonical
  encoding of its 32-byte Authorization Digest public input. The Platform
  Verifier MUST verify that proof against the digest recomputed under common
  REQ-COMMON-02 and REQ-COMMON-02A, not a browser-supplied candidate digest.
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
`/login/oauth/access_token` and `/user` sessions to the Proxy profile.

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
  The Prover MUST require the X or GitHub authorization redirect to
  carry an empty fragment and a query containing exactly one `state` plus
  exactly one `code` XOR `error`. The Prover MUST reject duplicate,
  mixed-transport, additional
  authoritative, and malformed fields. The single accepted `code` is the code
  consumed at redirect ingress that REQ-PLAT-29 and REQ-PLAT-46 compare
  against. GitHub's required `iss` under REQ-PLAT-34A is a profile field, not
  an additional authoritative field to reject.
- REQ-PLAT-28A (upholds SP-DELIVERY-01):
  The Prover MUST match the redirect's `state` to its bound live ceremony and
  accept that return only once before starting the token request. No
  server-side state, prepare request, or application-wide ceremony lookup
  participates in this check.

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

The whole request is revealed. The table fixes field order for canonical
serialization under common §6, not to protect a hidden suffix; REQ-PLAT-63
holds the complete body to the canonical form grammar of common
REQ-COMMON-07A.

- REQ-PLAT-29 (upholds SP-EXCHANGE-01):
  The Implementation MUST reveal the token request's `code` range. The
  Prover MUST require that revealed serialized value to equal the
  canonical form serialization of the code it parsed from the retained OAuth return,
  byte for byte, under common REQ-COMMON-07.
- REQ-PLAT-30 (upholds SP-BIND-01):
  The Proving Circuit MUST constrain the opened bearer range to nonempty
  printable ASCII of at most 4096 bytes. The carriage-return and line-feed
  exclusion of common REQ-COMMON-37 applies to this range, because the
  identity session sends it inside a header. Necessity: the range is opened
  to link two attestations, so it needs a bound and a charset; the circuit
  verifies no other property of the token response.
- REQ-PLAT-63 (upholds SP-EXCHANGE-01, SP-BIND-01, SP-CLIENT-01):
  The Prover and Platform Verifier MUST require the complete request body to
  satisfy the canonical form grammar of common REQ-COMMON-07A for exactly the
  five fields in the table, in that order.
  The Prover and Platform Verifier MUST reject malformed encoding, noncanonical
  spelling, an extra or duplicate field, or bytes outside that complete body.
  The Prover and Platform Verifier MUST enforce common REQ-COMMON-16B's
  charset for `client_id` and common §7's canonical unpadded base64url
  encoding of exactly 32 bytes for `code_verifier`. `code` and
  `redirect_uri` are nonempty values with no further constraint: the Platform
  Verifier reads neither and judges only their bytes under REQ-COMMON-07A,
  and the Canonical Runtime compares them with the values it serialized under
  REQ-PLAT-29 and REQ-PLAT-29C. The `grant_type` value is the exact ASCII
  bytes `authorization_code`, which REQ-PLAT-56 compares. No `refresh_token`,
  device-flow field, or other grant field is admitted; the pinned endpoint
  receives only this authorization-code request. Acceptance does not depend
  on X rejecting malformed or duplicate forms. The Canonical Runtime's
  comparisons of `code`, `grant_type` and `redirect_uri` under REQ-PLAT-29
  and REQ-PLAT-29C are separate local checks; the Platform Verifier's
  digest-to-verifier comparison remains common REQ-COMMON-15A. Necessity:
  revealing a range does not reject a form delimiter inside it, and the
  circuit does not scan for duplicates under common REQ-COMMON-19C; holding
  the whole body removes the platform's parser from the soundness argument.

The request is one revealed range: the request line, every header and the
body. The rows below name what the Platform Verifier reads out of it, not
separate ranges; the attested record carries adjacent revealed ranges as one,
so a plan of one range per field would not survive signing.

Per common §9, the token session reveals exactly these ranges; every other
byte stays behind a charset-constrained range commitment of the pinned
attestation format:

| Range | Revealed | Why |
|---|---|---|
| the request line and every request header | yes | the Platform Verifier compares the method and path with its profile constants, requires `host` and the media type that selects the parser the platform applied to the body rows beneath this one (common REQ-COMMON-21B), and refuses the headers REQ-PLAT-56A forbids |
| endpoint authority | not a range | the Notary Service authenticated the TLS server identity, and the Platform Verifier compares the attested authority against its pinned constant per common REQ-COMMON-21A |
| `grant_type` | yes | constant `authorization_code`; the Platform Verifier compares it byte for byte per REQ-PLAT-56 |
| `client_id` | yes | the Platform Verifier reads and returns it |
| `code` | yes | Prover compares the code parsed from its retained OAuth return |
| `redirect_uri` | yes | Prover compares the Application's frozen redirect URI; no chain or circuit value |
| `code_verifier` | yes | the Platform Verifier recomputes it from the digest and `authorizationNonce` per common REQ-COMMON-15A |
| attestation timestamp | not a range | the attestation's own signed creation time, which derives the authenticated validity ceiling per §2.2 |
| `"access_token":"` and the closing quote immediately around the bearer value | yes | anchor the committed bearer range as that field's value, per common REQ-COMMON-18A |
| bearer range | committed | a blinded commitment, opened only in circuit |
| everything else | no | the response status line and headers, `scope`, `token_type`, other response fields |

Neither the authority nor the attestation timestamp is a transcript range.
The authority reaches the Platform Verifier as
the TLS server identity the Notary Service authenticated under common
REQ-COMMON-21, carried in the attested data: the transcript
holds the authority only in a `host` header, which the first row reveals and
REQ-PLAT-56A holds to the pinned authority, and that header is
prover-composed text that says nothing about which server answered. The
timestamp is the signed creation time of the attested data itself, which is why common REQ-COMMON-25 can forbid inferring it from a
response header. The two delimiter reveals are what anchor the committed range in the
received direction, which would otherwise reveal no byte at all and leave that
range indistinguishable from a `refresh_token` value.

Those reveals and the Platform Verifier's `code_verifier` comparison under
REQ-COMMON-15A bind the request, but revealing a range does not reject a form
delimiter inside it. REQ-PLAT-63 therefore holds the complete body to the exact
five-field form; X, like GitHub, does not depend on ASM-PROV-07.

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
  attestation the Platform Verifier checks. The Prover MUST
  reject a transcript whose revealed serialized `grant_type` or `redirect_uri`
  value differs from the canonical form serialization of, respectively, the
  selected profile's `authorization_code` constant or the Application's frozen
  redirect URI. Neither value is a circuit
  constraint or a public proof input, and neither is a value the Consumer
  reads; the Platform Verifier compares the revealed `grant_type` itself
  under REQ-PLAT-56. Revealing them narrows the body a prover can compose
  without being observed; it does
  not by itself exclude a duplicate field, which REQ-PLAT-63 rejects over the
  complete body. The
  Platform Verifier enforces the disclosure: an attestation hiding either
  range does not match the profile layout of common REQ-COMMON-17A and
  REQ-COMMON-18A and fails verification.

The request carries `host: api.x.com`,
`content-type: application/x-www-form-urlencoded`, and a `content-length` of the
body's own count. The Canonical Runtime also sends `accept: application/json`
and `connection: close`, which nothing verifies, and may send any other header
REQ-PLAT-56A does not forbid.

- REQ-PLAT-56A (upholds SP-EXCHANGE-01):
  The Implementation MUST reveal the token request's request line and every
  header. The Platform Verifier MUST reject a head without exactly one `host`
  naming the pinned authority and exactly one `content-type` whose value is
  `application/x-www-form-urlencoded`, comparing names lowercased with every
  space and tab removed and `_` read as `-`, as common REQ-COMMON-39B
  normalizes, and values exactly once the optional whitespace around them is
  removed. The Platform Verifier MUST reject a head carrying `authorization`
  or any name common REQ-COMMON-39B forbids, under any spelling of the name.
  The Platform Verifier MUST ignore every other header, `content-length`
  excepted, which REQ-PLAT-56B holds to the body it frames. Necessity: common REQ-COMMON-21B fixes the media type
  because it "selects the platform's request parser", and a media type nothing
  compares is a pin in name only. The forbidden headers change what the
  platform does with the request in a way no revealed byte shows: which client
  it authenticates, which session it answers for, which bytes it parses, which
  method it runs. Any other
  header changes only what the platform answers, and a wrong answer is a
  response the verifier cannot read rather than one it can be fooled by, so
  requiring its absence would bind every prover to one HTTP library's habits
  for nothing.
- REQ-PLAT-56B (upholds SP-EXCHANGE-01):
  The Platform Verifier MUST reject a token request whose revealed bytes carry
  other than exactly one empty line, the one that ends the head. The Platform
  Verifier MUST reject a head without exactly one `content-length`, or with
  one other than the decimal count of the body it frames, written without a
  leading zero. Necessity: the verifier takes the body to be what follows the
  head while the platform takes it to be `content-length` bytes, so where the
  two disagree the fields read are not the fields parsed; a second empty line
  is a second place a parser could end the head, and a second spelling of the
  count is a second thing to compare one spelling of.
- REQ-PLAT-56C (upholds SP-EXCHANGE-01):
  The Platform Verifier MUST reject a head carrying a line feed not preceded by
  a carriage return, a carriage return not followed by a line feed, a line
  beginning with a space or a tab, or a header field line with no colon.
  The colon requirement excludes the separately validated request line and the
  empty line terminating the head. Necessity: a
  parser accepting a bare line feed, a bare carriage return or a fold ends the
  head somewhere this one does not, moving bytes between head and body, and a
  line no colon splits is not a header field, so a parser that tolerates one
  reads a head this one cannot. Common REQ-COMMON-39A asks the first three of
  the identity request.
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

`GET https://api.x.com/2/users/me` with no query. The request carries these
four headers, in any order, and may carry others: `authorization: Bearer
<access_token>`, `accept: application/json`, `host: api.x.com`, and
`connection: close`. The Platform Verifier compares the request line and the
`authorization` line, refuses the names common REQ-COMMON-39B forbids, and
compares no other header.

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
  The Prover MUST derive the X `userId` and raw handle from
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

GitHub uses a public client with S256 PKCE. The Prover, the browser proving
part of the Canonical Runtime, performs both the token exchange and `/user`
inside browser-owned notarization sessions. The OAuth application credential
called `client_secret` by GitHub is intentionally public: it is supplied in
public configuration, sent in the token request, and revealed in its attestation.
It is not proof of the caller's authority.

This follows GitHub's [public-client guidance][GitHub-public-clients], which
includes single-page applications and recommends PKCE. The profile removes
server-side token-exchange custody; browser and service specifications own the
configuration and delivery of these public inputs.

As on X, the evidence is two attestations and one hidden bearer linking them.
The bearer-link circuit and its two commitment public inputs are unchanged.
The Platform Verifier binds the revealed `code_verifier` to the Authorization
Digest under common REQ-COMMON-15A; the circuit does not perform that binding.

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

### 6.1a Authorization return

GitHub returns the authorization response in the redirect query. In addition
to `state` and exactly one of `code` or `error`, the response carries `iss`, the
authorization-server issuer identifier defined by [RFC9207]. This profile pins
`https://github.com/login/oauth`, matching
[GitHub's authorization-server metadata](https://github.com/.well-known/oauth-authorization-server/login/oauth).
The expected value is a profile constant, not discovered from the response or
the configured redirect URI.

- REQ-PLAT-34A (upholds SP-DELIVERY-01):
  The Prover MUST accept a GitHub success, denial, or other OAuth error response
  only when its query contains exactly one `iss` whose value, decoded once as
  `application/x-www-form-urlencoded`, equals
  `https://github.com/login/oauth` by exact string comparison. Necessity:
  matching the response issuer to the selected authorization server prevents
  OAuth authorization-server mix-ups before credentials are used.

Missing, duplicate, malformed, or mismatched issuer values are browser
rejections before token exchange, not valid denials. Equivalent form-encoding
spellings are accepted, but URL normalization, case folding, trailing-slash
removal, and default-port removal do not repair a different decoded value.
This check precedes success/denial/error classification; a matching issuer
does not waive the state or remaining return checks. `iss` identifies the
authorization server, not the user or OAuth client, and is not itself signed
evidence. It adds no proof input or browser-protocol message field and does
not replace downstream verification.

### 6.2 Token exchange

`POST https://github.com/login/oauth/access_token`, media type
`application/x-www-form-urlencoded`, `Accept: application/json`:

| Order | Field | Exact value |
|---|---|---|
| 1 | `client_id` | configured client identifier |
| 2 | `code` | consumed redirect code |
| 3 | `redirect_uri` | immutable redirect URI |
| 4 | `code_verifier` | PKCE verifier per common §7 |
| 5 | `client_secret` | public OAuth application credential frozen for this ceremony; revealed |

The whole request is revealed. The table fixes field order for canonical
serialization under common §6, not to protect a hidden suffix. The credential
stays in the form body so the authenticated client identifier and the complete
request grammar have one representation; an `Authorization` header remains
forbidden by REQ-PLAT-56A.

- REQ-PLAT-61 (upholds SP-EXCHANGE-01, SP-BIND-01, SP-CLIENT-01):
  The Prover and Platform Verifier MUST require the complete request body to
  satisfy the canonical form grammar of common REQ-COMMON-07A for exactly the
  five fields in the table, in that order.
  The Prover and Platform Verifier MUST reject malformed encoding, noncanonical
  spelling, an extra or duplicate field, or bytes outside that complete body.
  The Prover and Platform Verifier MUST enforce common REQ-COMMON-16B's
  charset for `client_id` and common §7's canonical unpadded base64url
  encoding of exactly 32 bytes for `code_verifier`. `code`, `redirect_uri`
  and `client_secret` are nonempty values with no further constraint: the
  Platform Verifier reads none of them and judges only their bytes under
  REQ-COMMON-07A, and the Prover compares `code` and `redirect_uri` with the
  values it serialized under REQ-PLAT-46 and REQ-PLAT-48A.
  No `grant_type`, `refresh_token`, device-flow field, or other extension is
  admitted; the pinned endpoint receives only this authorization-code request.
  Acceptance does not depend on GitHub rejecting malformed or duplicate forms.
  The Prover additionally compares `code` and `redirect_uri` with its captured
  code and frozen redirect under REQ-PLAT-46 and REQ-PLAT-48A. Those local
  expected values are not Platform Verifier inputs; its digest-to-verifier
  comparison remains common REQ-COMMON-15A.

- REQ-PLAT-35A (upholds SP-CLIENT-01):
  The Proving Circuit MUST NOT expose `client_secret`, or any value derived
  from it, as a public proof input. Necessity: the complete request already
  reveals it; the circuit's only semantic public inputs remain the bearer
  commitments, not duplicated request fields.
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

### 6.3 Browser notarization

- REQ-PLAT-62 (upholds SP-EXCHANGE-01, SP-CLIENT-01):
  The Prover MUST perform the token and identity sessions using browser
  TLSNotary Proxy mode with the same selected notary address and the endpoints
  fixed by this profile. The Prover MUST use the client identifier, public
  application credential, and redirect URI frozen for the ceremony.
  The Prover MUST NOT delegate the token exchange to an OAuth Bridge or fetch
  replacement configuration during the ceremony. Notary routing does not select
  trusted signing keys; the Consumer Chain's Notary Service checks those.
- REQ-PLAT-37 (upholds SP-BIND-01):
  The Prover MUST use the exact authorization code consumed from the redirect
  and the exact PKCE verifier derived for that ceremony as `code` and
  `code_verifier` in §6.2.
- REQ-PLAT-38 (upholds SP-EXCHANGE-01):
  The Prover MUST correlate the bearer, its commitment opening, and the final
  token attestation with the same browser notarization session.
  The Prover MUST reject a mixed-session tuple or a partial final result.
- REQ-PLAT-55 (upholds SP-CLIENT-01):
  The Canonical Runtime MUST treat the bearer commitment opening as private
  witness material for the Proving Circuit.
  The Canonical Runtime MUST NOT include that opening in a Submission, log,
  or published artifact. Necessity: publishing the opening defeats the
  commitment's protection against guessing the bearer.

Session setup and proof preparation may overlap. The token response's parsed
bearer can feed `/user` before the final token attestation arrives. That bearer
and any early witness material are provisional; proof delivery waits for both
final, structurally checked and correlated attestations. Neither session's
failure can be turned into a partial successful ceremony.
- REQ-PLAT-43B:
  The Prover MUST reject redirects from the token endpoint. Necessity: a
  followed redirect would notarize a session other than the pinned endpoint.

### 6.4 Disclosure and verification

Prover obtains the token attestation from its browser notarization session.
The complete request, including `client_secret`, is one revealed range. There
is no committed request suffix. The response still commits the bearer and
reveals its framing; all other response bytes retain their existing layout.

The browser keeps the bearer and commitment openings as private witness
material under REQ-PLAT-55. The final proof carries the original signed
attestation bytes, not a separately supplied copy of the public credential.
The Notary Service verifies this attestation on the Consumer Chain, exactly
as it verifies the `/user` attestation.

| Range | Revealed | Why |
|---|---|---|
| `client_id` | yes | the Platform Verifier reads and returns it; Prover compares it with the Application's frozen client |
| `code` | yes | Prover compares the code parsed from its retained OAuth return |
| `redirect_uri` | yes | Prover compares the Application's frozen redirect URI |
| `code_verifier` | yes | the Platform Verifier recomputes it from the digest and `authorizationNonce` per common REQ-COMMON-15A |
| `"access_token":"` and the closing quote immediately around the bearer value | yes | anchor the committed bearer range as that field's value, per common REQ-COMMON-18A |
| bearer range | committed | a blinded commitment, opened only in circuit to link this attestation to `/user` |
| attestation timestamp | not a range | the attestation's own signed creation time, which derives the authenticated validity ceiling per §2.2 |
| token endpoint authority | not a range | the Notary Service authenticated the TLS server identity, and the Platform Verifier compares the attested authority against its pinned constant per common REQ-COMMON-21A |
| the request line and every request header | yes | the Platform Verifier compares the method and path with its profile constants, requires `host` and the media type that selects the parser the platform applied to the body rows beneath this one (common REQ-COMMON-21B), and refuses the headers REQ-PLAT-56A forbids |
| `client_secret` | yes | public application credential; complete form validation under REQ-PLAT-61 leaves no hidden request field |
| everything else | no | the response status line and headers, `scope`, `token_type`, other response fields |

Every unrevealed range stays behind the pinned attestation format's range
commitment. The delimiter row is what anchors the committed bearer range in
the received direction, which would otherwise carry no revealed byte and
leave that range indistinguishable from a `refresh_token` value. Neither the
authority nor the attestation timestamp is a transcript range at all. The
authority reaches the Platform Verifier
as the TLS server identity the Notary Service authenticated under common
REQ-COMMON-21, carried in the attested data, because the
transcript holds the authority only in a `Host` header, and that header is
prover-composed text that says nothing about which server answered. Revealing
it, as REQ-PLAT-56A now requires, does not make it the authority: it is one
of the two headers the verifier holds to a pinned value, while the
authority continues to reach the verifier as the authenticated TLS server
identity. The timestamp is the signed creation time of the attested
data itself, which is why common REQ-COMMON-25 can forbid inferring it from a
response header. Revealing more than this would widen exposure without adding
a check -- the full request is checked, while the undisclosed response fields
are platform-owned bytes that no verifier reads.

The exchange request carries `host: github.com` and the pinned media type.
Prover also sends `accept: application/json` and `connection: close`, which
nothing verifies. REQ-PLAT-56B holds Content-Length to the complete revealed
body; common REQ-COMMON-18A holds the request range to the signed layout.

- REQ-PLAT-43D (upholds SP-EXCHANGE-01):
  The Prover and Platform Verifier MUST require the request direction to be
  one fully revealed range covering its complete signed length, without hidden,
  omitted, or overlapping bytes.
  The Prover MUST reveal no response range outside the rows marked `yes`
  above. The Prover MUST commit the bearer range rather than reveal it.
  REQ-PLAT-56A, REQ-PLAT-56B, REQ-PLAT-56C and REQ-PLAT-61 apply to this
  request. The previous hidden-`client_secret` request layout is not accepted.
- REQ-PLAT-58 (upholds SP-EXCHANGE-01):
  The Prover MUST reveal the `"access_token":"` delimiter
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
  The Prover MUST validate each final token attestation's exact structure,
  canonical encoding, profile authority/method/path, request bindings, and
  commitment/opening correlation before proof delivery. Neither Prover nor
  Application performs local notary-signature verification. Signature-format
  checks do not establish authenticity; the Consumer Chain's Notary Service
  authenticates the original signed bytes under common REQ-COMMON-33 and
  REQ-COMMON-33A. This omits early cryptographic forgery detection, not ledger
  verification.
- REQ-PLAT-45 (upholds SP-EXCHANGE-01):
  The Prover MUST obtain an attestation carrying the selected notary's
  signature and revealing the token request's method and path.
  The Platform Verifier MUST compare the attested authority and the revealed
  method and path with this profile under common REQ-COMMON-21A.
- REQ-PLAT-46 (upholds SP-EXCHANGE-01):
  The Prover MUST require the disclosed serialized `code` value to
  equal the canonical form serialization of the code it consumed at redirect
  ingress, byte for byte.
- REQ-PLAT-47 (upholds SP-CLIENT-01):
  The Prover MUST require the disclosed `client_id` to equal the client
  frozen by the Application. Common REQ-COMMON-16B makes those bytes
  identical before and after form serialization.
- REQ-PLAT-48 (upholds SP-BIND-01):
  The Prover MUST require the disclosed `code_verifier` to equal the derived
  verifier supplied by the Application; it does not rederive it. Its
  base64url alphabet is byte-identical under form serialization.
- REQ-PLAT-48A (upholds SP-EXCHANGE-01):
  The Prover MUST require the disclosed serialized `redirect_uri` value to
  equal the canonical form serialization of the immutable value supplied by
  the Application.
- REQ-PLAT-49 (upholds SP-EXCHANGE-01):
  The Prover MUST require the token-response bearer, under its same-session
  commitment opening, to open the token attestation's bearer commitment.
- REQ-PLAT-50 (upholds SP-EXCHANGE-01):
  The Prover MUST fail the ceremony without proof delivery when any check in
  REQ-PLAT-38 or REQ-PLAT-44 through REQ-PLAT-49 fails.
  The Prover MUST discard provisional witness/proof material and stop pending
  dependent work on that failure. A failure observed before `/user` starts
  prevents it; a later failure does not undo an already sent request.
  A structurally valid forged signature alone is not a browser rejection;
  authoritative notary verification rejects it downstream.

Full disclosure is not sufficient by itself: REQ-PLAT-61 verifies the complete
form grammar instead of matching arbitrary substrings. GitHub therefore has no
hidden request-field assumption and no dependency on ASM-PROV-07's
platform-side duplicate-field rejection. TLS authority, PKCE, one-use code,
notary authenticity, and bearer-link verification remain required.

### 6.5 Identity request

`GET https://api.github.com/user` with no query. The request carries these
six headers, in any order, and may carry others:
`authorization: Bearer <access_token>`, `accept: application/vnd.github+json`,
`x-github-api-version: 2022-11-28`, `host: api.github.com`,
`connection: close`, and a `user-agent` of the Canonical Runtime's choosing,
which GitHub requires of every API request and answers `403` without. The
Platform Verifier compares the request line and the `authorization` line,
refuses the names common REQ-COMMON-39B forbids, and compares no other
header.

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
  response. The Implementation MUST keep the JSON whitespace GitHub puts
  inside either member in the revealed range, per common REQ-COMMON-19F. The
  Implementation MUST redact every other response byte behind a range
  commitment. Necessity: REQ-PLAT-51 reads both fields out of
  revealed response bytes, and a session revealing no response range at all
  leaves it nothing to read.
- REQ-PLAT-51 (upholds SP-BIND-01):
  The Platform Verifier MUST extract `id` and `login` from the revealed
  response bytes by their full field delimiters, rejecting a transcript in
  which either delimiter matches at more than one position, per common
  REQ-COMMON-19A. The Platform Verifier MUST reject a noncanonical `id`
  encoding. The GitHub profile fixes the structural byte following the
  `id` integer token, which common REQ-COMMON-19D leaves to the profile, as
  `,` or `}` and no other byte, judged after the removal common
  REQ-COMMON-19F fixes. The Platform Verifier MUST reject any other
  following byte. Necessity: the terminator is what proves the revealed digits
  are the whole number rather than a prefix of a longer one, and JSON member
  order does not guarantee which of the two closes it.
- REQ-PLAT-51A (upholds SP-BIND-01):
  The Prover MUST derive the GitHub `userId` and raw handle
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
  The Canonical Runtime MUST start a fresh ceremony when GitHub consumed the
  code but usable evidence was lost. Necessity: browser token exchange remains
  a single-use, non-recoverable step; no Bridge result or replay exists.

## 7. Adding an identity platform

The Platform Profile for a new platform MUST define a stable platform
identifier and immutable
user-ID namespace; canonical handle normalization and authenticated
observation ordering; client portability or a bounded client family; exact
authorization and redirect transport; every authenticated request and
response field with its provenance; how the Authorization Digest is carried
through that platform's authorization; its authenticated client-binding source; an
authenticated proof-validity rule and the value of each protocol parameter it
names; whether it exposes identity bytes or is a digest profile (§2.1b),
and a digest profile's handle-digest construction (REQ-PLAT-08M); its
trust-root lifecycle;
browser and deployment data exposure, retry, interruption, and withholding
behavior; and conformance vectors.

## 8. Conformance

Roles: Canonical Runtime (including Prover), Proving Circuit,
Platform Verifier, Notary Service, Consumer.

- TEST-PLAT-01 (exercises REQ-PLAT-10, REQ-PLAT-18):
  The §3.1 nonce vector reproduces exactly. A proof bound to another token
  nonce is rejected downstream when verified against this authorization's
  recomputed digest, independently of the browser result-consistency checks.
- TEST-PLAT-02 (exercises REQ-PLAT-04, REQ-PLAT-05, REQ-PLAT-05A, REQ-PLAT-06, REQ-PLAT-07, REQ-PLAT-08):
  The §2.1 identifier vectors reproduce, the Google one as its digest, and
  each listed malformed identifier is rejected. A Google `sub` signed as
  `12\/3` is rejected by an implementation that JSON-decodes the token, as
  by one that reads the signed bytes.
- TEST-PLAT-03 (exercises REQ-PLAT-11, REQ-PLAT-12):
  A Google authorization request not using the exact direct-ID-token fragment
  profile is rejected. A nonempty query, mixed query/fragment response, or
  fragment carrying duplicate `state`, both `id_token` and `error`, `code`, or
  `access_token` is rejected.
- TEST-PLAT-04 (exercises REQ-PLAT-13, REQ-PLAT-14, REQ-PLAT-14A, REQ-PLAT-14B):
  The browser Prover rejects a return whose `state` does not match its bound
  live ceremony, or has already been consumed, and rejects a missing,
  malformed, padded, noncanonical, or non-32-byte nonce. No server-side state
  lookup occurs. An otherwise valid signed token with a canonical nonce for
  another digest supplies that candidate to Prover's circuit, but Application
  rejects the delivered public inputs against its retained digest. Downstream
  verification independently rejects that proof against the requested
  authorization's recomputed digest. The browser test adds no expected-digest
  field to `ProveIdentity`.
  A changed public input, delivered identity field, expiry, or signing modulus
  that no longer matches its projection fails the corresponding browser check.
  A structurally valid forged proof whose supplied public inputs still match
  the projection has no local cryptographic rejection and must fail downstream
  proof verification; matching fields alone do not authenticate them.
- TEST-PLAT-05 (exercises REQ-PLAT-15):
  A Google response carrying an authorization code or access token is rejected,
  and the deployment contains no Google exchange route or client secret.
  Verification: inspection of emitted artifacts.
- TEST-PLAT-06 (exercises REQ-COMMON-19D, REQ-PLAT-16, REQ-PLAT-16A, REQ-PLAT-16B, REQ-PLAT-16C, REQ-PLAT-17, REQ-PLAT-19, REQ-PLAT-19A, REQ-PLAT-20, REQ-PLAT-21, REQ-PLAT-23):
  The browser Prover rejects an audience differing from its frozen client.
  A token with a foreign issuer, `email_verified: false`, a
  quoted or non-boolean `email_verified`, a quoted, negative, fractional,
  exponent, leading-zero, or overflowing `exp` cannot satisfy the circuit.
  A signature incompatible with the fixed RS256 relation or supplied modulus
  likewise fails the circuit. Substitution of signed header/payload bytes or
  signature invalidates that relation; public-output substitution fails proof
  verification downstream. These are not separate browser proof-verification
  requirements. A cryptographically valid proof under an inactive signing modulus passes
  circuit verification but is rejected by the Platform Verifier. A submission
  whose supplied `aud` bytes do not hash to the audience public input is
  rejected, and an accepted one returns those exact bytes as the client
  identifier. A token whose `sub` is empty or carries a byte outside `0x20`
  through `0x7e` fails the Proving Circuit, and no public input carries the
  `sub`.
- TEST-PLAT-06A (exercises REQ-PLAT-08M, REQ-PLAT-16B, REQ-PLAT-16C, REQ-PLAT-16D):
  `Alice@Gmail.com` and `alice@gmail.com` prove the same handle digest,
  `0x5ecf20af6a3cb20cb8e5e2c6e7a7c3ae5aa37239c008643be631d93498ef23e1`, the
  REQ-PLAT-08M digest of the normalized handle the Consumer derives from the
  plaintext. An `email` with a space, two `@`, an empty local part, a
  byte outside the normalization's alphabet, or bytes past its signed length
  cannot satisfy the circuit; neither can a `sub` holding `\` (as `12\/3`
  does), a 32-byte `sub`, or a 63-byte `email`. The public inputs carry no
  `sub` or `email` byte. The Platform Verifier returns the `userId` and the
  handle digest, returns the `email` a Submission carried byte for byte, and
  returns none where the Submission carried none; the payload has no field
  for a `sub`.
- TEST-PLAT-07 (exercises REQ-PLAT-22, REQ-PLAT-09, REQ-PLAT-09A):
  A proof at or after `proofValidUntil`, and a token-attestation creation time
  more than its profile's `maxFutureAttestationSkew` ahead of Block Time, are
  rejected. An X or GitHub identity-attestation timestamp changes neither
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
- TEST-PLAT-09C (exercises REQ-PLAT-29C, REQ-PLAT-56, REQ-PLAT-56A, REQ-PLAT-56B, REQ-PLAT-56C, REQ-PLAT-63):
  The Platform Verifier rejects an X attestation that hides the `grant_type`
  or `redirect_uri` range, and Prover rejects a revealed value differing from
  the canonical form serialization of the profile's grant type or the
  Application's frozen redirect URI, respectively.
  A redirect URI containing `:` and `/` passes in that encoded form and fails
  as literal unencoded bytes. The Platform Verifier rejects an
  attestation whose revealed `grant_type` is `refresh_token`, and one whose
  `grant_type` differs from `authorization_code` in any byte, even when every
  other revealed range and the proof itself check out. The Platform Verifier
  accepts a token request whose headers arrive in another order, or carry a
  header the profile does not name, and one whose required names are spelled
  in another letter case, with `_` for `-`, or padded before the colon; it
  rejects a head missing `host` or `content-type`, carrying either twice, or
  carrying `authorization`, `cookie`, `content-encoding`, `transfer-encoding`
  or a method-override name under any spelling; it rejects a head with no
  empty line or a second one, with no `content-length` or two, or with a
  count that is not the body's length, is not decimal digits, or carries a
  leading zero, and accepts the count wherever it sits in the head; and it
  rejects a head carrying a bare line feed, a bare carriage return, an
  obsolete line fold, or a header field line with no colon. An otherwise valid
  request with a colon-free request line and its terminating empty line passes.
  The canonical five-field body passes; missing, empty, additional, duplicate,
  reordered, malformed, or noncanonical fields fail even if X were to accept
  them. Encoded duplicate names cannot evade the exact name/serialization
  check. A value with encoded delimiters remains one value and passes; raw
  delimiters creating more fields fail. Refresh or device-grant fields fail.
  Invalid client-identifier bytes and a noncanonical or wrong-length PKCE
  verifier fail. Canonical form escaping in `code` and `redirect_uri` passes
  the form check; a mismatch with the consumed code or the deployment
  profile's redirect still fails under REQ-PLAT-29 and REQ-PLAT-29C. A `code`
  or `redirect_uri` whose canonical escapes decode to bytes that are not UTF-8
  passes the form check, which the Implementation never emits, and fails those
  comparisons.
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
- TEST-PLAT-12 (exercises REQ-PLAT-34, REQ-PLAT-35A, REQ-PLAT-35B, REQ-PLAT-35C, REQ-PLAT-61):
  Scope other than `read:user` rejects locally. The complete token request
  reveals the public credential and client ID, while the circuit adds neither
  as a public input. The Platform Verifier returns the revealed client ID.
  The canonical five-field form passes; missing, empty, additional, duplicate,
  reordered, malformed, or noncanonical fields fail downstream even if the
  platform were to accept them. Encoded duplicate names cannot evade the
  exact name/serialization check. A credential with encoded delimiters remains
  one value and passes; raw delimiters creating more fields fail. Refresh or
  device-grant fields fail. All accepted lengths cover the complete body.
  Invalid client-identifier bytes and a noncanonical or wrong-length PKCE
  verifier fail. Canonical form escaping in `code` and `redirect_uri` passes
  the form check; a mismatch with the captured code or frozen redirect still
  fails the Prover's local comparisons. A `client_secret` whose canonical
  escapes decode to bytes that are not UTF-8 passes: the Platform Verifier
  judges its bytes and decodes nothing. The same in `code` or `redirect_uri`
  passes the form check and fails the Prover's local comparisons.
- TEST-PLAT-12A (exercises REQ-PLAT-28, REQ-PLAT-28A, REQ-PLAT-34A):
  For otherwise valid GitHub success, `access_denied`, and other OAuth error
  returns, the browser Prover accepts the exact issuer in literal or equivalent
  form-encoded spelling. It rejects missing or duplicate `iss`, malformed
  encoding, a foreign issuer, changed case, an added default port, or a trailing
  slash before token exchange; an invalid issuer never resolves denied.
  Correct `iss` with wrong state remains rejected. X acquires no GitHub issuer
  prerequisite, and no proof or browser-protocol record gains an issuer field.
- TEST-PLAT-13 (exercises REQ-PLAT-37, REQ-PLAT-38, REQ-PLAT-62):
  Prover sends the frozen client/credential/redirect and ceremony code/verifier
  through its token Proxy session, using the same selected notary as identity.
  No Bridge token request or configuration refetch occurs. Both session setups
  and proof preparation may overlap; `/user` waits for a parsed bearer but
  not necessarily the final token attestation. A mixed-session tuple or partial
  final result fails; both final attestations are required for delivery.
  Qualification uses the matched browser WASM and real Proxy notary for both
  GitHub endpoints, not only mocks or a native MPC token session.
- TEST-PLAT-14 (exercises REQ-PLAT-43B, REQ-PLAT-43D, REQ-PLAT-43E, REQ-PLAT-56A, REQ-PLAT-56B, REQ-PLAT-56C, REQ-PLAT-61):
  A redirected token exchange rejects in Prover. Downstream layout validation
  rejects a hidden request suffix, omitted request bytes, gaps, overlaps,
  response disclosures outside the profile, or a revealed bearer. The
  head vectors of TEST-PLAT-09C run on this request too: unlisted headers pass,
  forbidden or missing required headers reject, and Content-Length matches
  the complete revealed body. The previous hidden-secret layout fails.
- TEST-PLAT-15 (exercises REQ-PLAT-44, REQ-PLAT-45, REQ-PLAT-46, REQ-PLAT-47, REQ-PLAT-48, REQ-PLAT-48A, REQ-PLAT-49, REQ-PLAT-50):
  Malformed canonical attestation bytes, authority/method/path, request
  bindings, signature shape, or bearer/opening correlation fail in Prover.
  Failure before identity HTTP prevents it. Failure after provisional bearer
  use stops remaining work and discards any speculative proof; it never
  delivers partial evidence. A structurally valid forged signature preserving
  all checked correlations has no local cryptographic rejection, but fails
  trusted-notary verification downstream. Application structural acceptance
  does not establish signature authenticity.
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
  live ceremony that substitutes a newer profile is rejected, a profile missing
  from the Application, Distribution list, or Bridge configuration is
  ineligible, and the profile identifies the same proof statement
  and semantic public inputs across two chains using different conforming
  verifier artifacts. A destination chain does not support the pair without a
  conforming artifact or, for a TLSNotary profile, a compatible Notary Service.
  No local identity field originates outside proof public inputs, the exact
  revealed attestation bytes carried by its Submission, and, for a digest
  profile, the signed ID Token whose digests its proof carries. Only the Consumer's
  acceptance of that exact Submission makes the claim authoritative.
- TEST-PLAT-17A (exercises REQ-PLAT-03, REQ-PLAT-31A, REQ-PLAT-51A):
  Pair authenticated X or GitHub identity-response bytes for account B with a
  detached `userId`, handle, or metadata value for account A offered as an
  extraction input. Prover rejects that alternative source; without it, Prover
  and the Platform Verifier both derive account B byte for byte. Prover may
  deliver its derived identity separately through CCDP, and Application accepts
  its valid structure without repeating evidence extraction. The delivered
  `userName` preserves the raw handle even when display normalization would
  change its spelling. Replacing the proof,
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
  For each production Platform Profile that cites ASM-PROV-07, recurring
  integration probes send each profile-listed token request field twice, in
  both orders and using both literal and percent-encoded equivalent field
  names, and send the otherwise valid request under alternate media types.
  The production endpoint rejects every probe and issues no bearer. No launch
  profile cites ASM-PROV-07: X and GitHub hold the complete token body under
  REQ-PLAT-63 and REQ-PLAT-61, so the launch probe set is empty.
- TEST-PLAT-21 (exercises REQ-PLAT-38, REQ-PLAT-49, REQ-PLAT-55):
  A same-session bearer opening opens the token attestation commitment; a
  missing, mismatched, or other-session opening fails. The opening remains
  browser witness material and is absent from Submissions and published
  artifacts. There is no Bridge response whose fields supply it.
- TEST-PLAT-22 (exercises REQ-PLAT-57, REQ-PLAT-58, REQ-PLAT-59, REQ-PLAT-60):
  An X token attestation and a GitHub token-exchange attestation whose
  committed bearer range is not framed by the revealed `"access_token":"`
  delimiter and closing quote are each rejected, including one committing a
  `refresh_token` value instead; and an X `/2/users/me` or GitHub `/user`
  attestation revealing no `id`, `username`, or `login` range, or revealing
  a value without its full delimiter, is rejected.

## 9. Security Considerations

Browser validation does not authenticate attestation signatures or verify ZK
proofs. Google's Prover checks generated public inputs against its parsed
evidence; Application checks the delivered projection against its retained
digest and result fields, without receiving the token. A well-formed forgery
that preserves these checked relationships can still survive browser checks.
REQ-PLAT-14, REQ-PLAT-14A, REQ-PLAT-14B, REQ-PLAT-18, and REQ-PLAT-44 preserve the
distinction between local consistency and circuit/downstream verification;
TEST-PLAT-04 and TEST-PLAT-15 distinguish those later rejections from early
browser rejection. No ledger verification guarantee is weakened.

This document enforces SP-BIND-01, SP-CLIENT-01, SP-EXCHANGE-01, and
SP-FRESH-01 for the launch platforms, and SP-PRIV-01 for Google, under the
assumptions of [common §3](ceremony-common.md#3-assumptions).

Google is the only platform whose evidence is a bearer artifact: an ID Token
is complete evidence to whoever holds it. Its delivery is therefore
trust-bearing, and ASM-PROV-01 carries that weight. X and GitHub deliver an
authorization code, which is not evidence until redeemed, so a code alone
grants nothing.

X and GitHub are public clients. GitHub's application credential is a
required request field, not a confidential authenticator of the presenter.
Possession of that credential alone grants neither a user's bearer token nor
a valid identity proof. Redemption still requires a usable code and its PKCE
verifier; the registered redirect destinations and their code remain
trust-bearing for the local ceremony. Compromise of a browser holding those
inputs defeats their confidentiality.

Public application credentials can be reused outside this ceremony, including
for app-authenticated API traffic GitHub permits. This accepts an unquantified
availability risk from third-party abuse or platform suspension. The protocol
does not claim abuse isolation, and renaming the public configuration field
provides no confidentiality. This changes neither the downstream proof checks
nor their trust roots.

SP-BIND-01 rests on the platform enforcing the PKCE challenge match
(ASM-PROV-02) for X and GitHub, and on Google reflecting the requested nonce
into a signed token (ASM-PROV-05). ASM-PROV-02 is a live dependency on
platform behavior rather than a proven property. The Implementation claiming
conformance MUST run a recurring check that each platform still rejects a
mismatched `code_verifier`.

X and GitHub each reject noncanonical, extra or duplicate fields over the
fully revealed token request, under REQ-PLAT-63 and REQ-PLAT-61; neither
depends on ASM-PROV-07, and TEST-PLAT-19 has no launch profile to probe for
it. Both still assume the platform honors the canonical request, PKCE, and
one-use authorization-code semantics.

The Prover can withhold work or supply malformed evidence. Local request and
commitment checks detect structural substitution, not a well-formed forged
notary signature; the Consumer Chain's Notary Service remains authoritative.
A proof built outside the Canonical Runtime still faces those downstream
checks and the Transaction Author rule in
[common §12](ceremony-common.md#12-security-considerations).
Proxy notarization exposes session traffic to the notary; the protocol does
not promise bearer confidentiality from that notary. The bearer remains
hidden from the published proof by the two commitments and link circuit.

The notary key is a trust root for X and GitHub evidence. Its compromise
mints fresh evidence until the key is removed, and does not revoke authority
already committed.

Google has no server-side token exchange. Its fragment is not visible at
HTTP ingress, although the deployment controls Callback code. Its signed
ID Token reaches the redirect fragment and is cleared
before other work. The browser checks `state`, the configured audience, and
canonical nonce encoding and checks the delivered public-input projection;
the circuit binds the signed nonce and claims, and ledger verification binds
that proof to the recomputed authorization digest
and trusted signing key. A deployment backend can withhold the static redirect
document but cannot substitute an ID Token through a server exchange that
does not exist.

Google's JWKS rotation makes the trusted modulus set a liveness dependency
(REQ-PLAT-24): ledger verification rejects proofs while Google signs with an
untrusted modulus, even if browser proof generation completes.

A Google binding publishes the REQ-PLAT-05A digest, never the `sub`. The
digest keeps the `sub` from readers of the Consumer Chain, not from a party
that already holds it: every application a user signs in to with Google
knows that user's `sub` and can recompute the digest to find the binding.
Google's `sub` values are 21-digit decimal strings in practice, too few to
resist a well-resourced search.

Google is the launch digest profile (§2.1b): its `email` reaches the chain
only as its REQ-PLAT-08M digest unless a transaction carries it, and the Consumer
keys the binding on that digest and the `userId`.
What this hides is stated in
[common §12](ceremony-common.md#12-security-considerations) together with
what it does not hide: a guessed address or a `sub` held by another relying
party confirms the binding by hashing, the binding's existence and
observation time stay public, and a name that resolves through an ENS
gateway or an off-chain resolver is the address itself. The normalization
of §2.1a runs inside the Proving Circuit for this profile (REQ-PLAT-16C), so
the profile's handle rules are part of its proof statement, and the
Consumer holds them fixed once it has bound a Google identity
(REQ-PLAT-08G).

A stored name is not evidence. A handle moves without its name being
touched, by a later claim of the same identity, by another identity proving
it, or by a change of rules, so the Consumer answers a name only while its
author holds the handle (REQ-PLAT-08K). A reader that displays the stored
string without that test can show a handle its author no longer holds.

## 10. References

Normative: [RFC6749], [RFC7636], [RFC7515], [RFC7517], [RFC7518], [RFC7519],
[RFC8017], [OIDC], [RFC8446], [RFC9207].

Informative: [RFC9700], [TLSNotary-Proxy], [GitHub-public-clients].

[GitHub-public-clients]: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets

[RFC9207]: https://www.rfc-editor.org/rfc/rfc9207.html
