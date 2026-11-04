---
title: Identity-platform ceremonies
description: libID ceremony profiles for Google, X, and GitHub, defining authenticated identity fields, OAuth flows, evidence, proof validity, and failure behavior.
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
  A version identifies its statement within one set of canonical Platform
  Verifier addresses. Within that set, a changed statement MUST take a new
  version. A new set of canonical addresses MAY restate an existing version
  with a different statement; the previous set is then retired. The
  restated statement MUST NOT accept a proof or Submission Payload made for
  the previous one, since the digest binds no Platform Verifier address
  (common §12). Necessity: chain artifacts implement the versioned ceremony
  boundary; they do not define it.
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
  Platform Profile's canonical sources in the evidence it returns.
  Those fields are not an authority decision; only the Consumer's
  acceptance of the resulting Submission is. For X and GitHub, the Prover
  MUST read the identity fields from the exact identity-response bytes its
  attestation commits at the ranges the Platform Verifier frames, which are
  the bytes the proof opens.
  The delivered handle remains raw; a local folded display value follows
  REQ-PLAT-08C and does not replace it. The Prover MUST derive `metadataObservedAt`
  under §2.2 from the profile's evidence time, not from a detached identity value.
  The Prover MUST reject a caller-supplied or detached value used as an
  alternative source for `userId`, handle, or `metadataObservedAt`.

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
| Google | signed ID-Token `sub` | the `sub`, as signed | signed `email` |
| X | `/2/users/me.data.id` JSON string | decimal digits, as sent | `username` |
| GitHub | `/user.id` JSON integer token | decimal digits, as sent | `login` |

An identity's **id**, or account identifier, is the authenticated value in
the second column: Google's `sub`, and the X and GitHub identifiers.
`userId` is the id unchanged.

- REQ-PLAT-05A (upholds SP-BIND-01):
  The Implementation MUST derive an identity's id node as
  `SHA256(tag || id)`, where `id` is the account identifier's exact bytes
  and `tag` is the platform's user-id tag below. An id is never folded or
  otherwise transformed. Necessity: the id node is the key the Consumer
  binds the identity under, so every role must derive the same one, and the
  account identifier never reaches the Consumer Chain.
- REQ-PLAT-05B (upholds SP-BIND-01):
  The Implementation MUST derive an identity's handle node as
  `SHA256(tag || fold(handle))`, where `handle` is the handle's exact
  authenticated bytes, `fold` maps `A`-`Z` to `a`-`z` and changes no other
  byte, and `tag` is the platform's handle tag below. Necessity: one handle
  in two letter cases is one account on every launch platform, so it must
  have one key.
- REQ-PLAT-05C (upholds SP-BIND-01):
  The tags are these raw ASCII strings, hashed with no separator and no
  length prefix before the value:

  | Identity platform | User-id tag | Handle tag |
  |---|---|---|
  | Google | `libid.google.user-id` | `libid.google.handle` |
  | X | `libid.x.user-id` | `libid.x.handle` |
  | GitHub | `libid.github.user-id` | `libid.github.handle` |

  A tag MUST NOT be a prefix of another tag, and none of the six above
  is. Necessity: a node hashes `tag || value` with no separator, so
  distinct tags alone do not keep nodes apart: were one tag `t` and another
  `t || s`, the value `s || v` under `t` and the value `v` under `t || s`
  would hash the same bytes. Prefix-free tags keep two platforms, and an id
  and a handle of one platform, from ever sharing a node, and separate a node from a plain
  `SHA256` of the value another system may publish.
- REQ-PLAT-06 (upholds SP-BIND-01):
  The Implementation MUST require an X or GitHub identifier to be 1 to 20
  ASCII digits, exactly as the platform sent them: the contents of X's JSON
  string and the bytes of GitHub's JSON number token. The Implementation
  MUST require a Google `sub` to be 1 to 31 bytes from `0x20` through
  `0x7e`, holding neither `"` nor `\`, as the bytes appear in the signed
  payload. Necessity: the digits, and a `sub` without a quote or a
  backslash, keep a committed id from running past its token into the
  member after it, and 31 bytes is the Proving Circuit's `sub` buffer;
  whether the value is one the platform issues is the platform's to keep.

The anchors of REQ-PLAT-31 and REQ-PLAT-51 fix the JSON type of each id: a
quoted GitHub id or an unquoted X id is not framed. The Proving Circuit
enforces REQ-PLAT-06 on the account identifier it hashes; the Platform
Verifier never sees that identifier.

Conformance vectors, each node computed independently with SHA-256:

| Platform | Authenticated input | `userId` | Id node |
|---|---|---|---|
| Google | `sub: "110169484474386276334"` | `110169484474386276334` | `0x620866cfb4d2776a32cd94d8e8b55577526af86115ebf125d4ca1ca7bf07737e` |
| X | `"id":"2244994945"` | `2244994945` | `0x68291869976ffad2abf3e933ec9ab2623395ff8b3b9242e655e1da3ef43d4f94` |
| GitHub | `"id":583231` | `583231` | `0x475902b27989feb395b9b0cd3156aa573a9676c13155b8e7e3ddaf3e77181847` |

| Platform | Authenticated handle | Folded | Handle node |
|---|---|---|---|
| Google | `A.B+tag@Example.COM` | `a.b+tag@example.com` | `0x40169b5cc6400158aeef2a13b73a14fc36e5e1df8595572b8fe282a269f26dd4` |
| X | `Alice_1` | `alice_1` | `0xe09c4f5bfbbc723bc35701ea9d718a1c5edb29b1ed5bb0cb0fabb3c43d8136af` |
| GitHub | `OctoCat` | `octocat` | `0x381fb9d7d3b01214e58b94202ea10f78e169adef68bcc20d40c130deca6dfe74` |

Email, audience, client identifier, X username, and GitHub login never
replace the immutable `userId`.

### 2.1a The token check and folding

The Proving Circuit owns the step from the raw authenticated values to their
nodes. It opens the raw id and handle, checks that each is exactly the JSON
token the platform sent, folds the handle, and outputs both nodes. The check
refuses a value; it never trims, strips, or repairs one. The platform's own
format (a handle's alphabet and length, an id's grammar) is the platform's
to keep, and no role repeats it.

- REQ-PLAT-08A (upholds SP-BIND-01):
  The Notary Service MUST NOT case-fold, trim, or otherwise transform
  identity bytes. The Proving Circuit MUST reject an id or a handle that is
  not one whole JSON token as sent, per the check below. The Proving Circuit
  MUST hash the id unchanged and the handle folded under REQ-PLAT-05B, and
  MUST apply no other transform. Necessity: a commitment is framed only by
  revealed anchors, so a prover chooses where it ends; a value that stopped
  at a later quote, or past the digits, would give one account many nodes.
- REQ-PLAT-08B (upholds SP-BIND-01):
  The Consumer MUST key a binding only on the id node and handle node the
  Platform Verifier returns from a verified proof. The Consumer MUST NOT
  accept a caller-supplied node. Where a handle arrives as text, the
  Consumer MUST fold it under REQ-PLAT-05B and accept it only for the node
  it hashes to under the platform's handle tag. It MUST NOT apply a
  character-set or shape rule to that text. Necessity: the
  node arrives inside a proof, so a caller supplying it could name any
  identity it liked; and node equality already proves the text is the
  canonical form the circuit admitted, so a second rule set on the chain is
  a second copy that can only drift.
- REQ-PLAT-08C:
  A browser-side check exists only for display and local checks. No proof
  statement or Consumer behavior may rely on it. Necessity: a check running
  in software the prover chooses whether to run is not a defense.

The check is:

- a handle, and a Google `sub`: 1 or more bytes from `0x20` through `0x7e`,
  holding neither `"` nor `\`, at most the circuit's buffer; nothing
  trimmed, so a space or an `@` is part of the value as sent;
- an X or GitHub id: decimal digits under REQ-PLAT-06;
- a handle is then folded under REQ-PLAT-05B; an id never is.

The buffers are X and GitHub handles 39 bytes, Google addresses 62 bytes,
X and GitHub ids 20 digits, and a Google `sub` 31 bytes. A longer value fails
to prove; it is never truncated.

The circuits own the platform table. Each platform's tags, buffers and id
shape are its entry in libID-circuits' `lib/identity/platforms.json`, and
the shared cross-language vector table is its `lib/identity/handles.json`.
Every circuits release ships both files beside its verifiers; the circuits
compile their constants from them, and libID-contracts generates its
profile tags and its Rust and TypeScript tables from the shipped copies.
Every implementation reproduces the vector table; it, not this prose, is
the precision anchor. A profile that publishes no such table is ineligible.

- TEST-PLAT-20 (exercises REQ-PLAT-05A, REQ-PLAT-05B, REQ-PLAT-05C, REQ-PLAT-08A, REQ-PLAT-08B, REQ-PLAT-08C):
  Every implementation reproduces the shared vector table byte for byte,
  including every node in it; no tag is a prefix of another; a value a
  refusing row names fails to prove,
  including one holding `"`, `\`, a tab or a NUL, or longer than its
  buffer, while a handle with a leading `@` or a space proves as sent; a
  caller-supplied node is rejected; and a handle given as text in another
  letter case reaches the same node, while text no circuit hashes folds to
  a node no proof binds.

### 2.1b Bindings, disclosure, and names

A claim puts no plaintext user id, handle, or email on the Consumer Chain
unless it discloses the handle. The Consumer's bind call takes the
Submission and, beside it, one optional handle, a primary flag, and the
service fee:
`bind(platformId, version, payload, string handle, bool primary, uint256 feeAmount, address feeReceiver)`.
`bindPrivately(platformId, version, payload, feeAmount, feeReceiver)` is
that call with an empty handle and no primary flag. The fee rules are in
§2.1c. The Submission Payload has no field for a handle or an id. An empty
handle discloses nothing and keeps the bind unlisted. A nonempty handle is
disclosed, and with the primary flag it also becomes the author's name.

- REQ-PLAT-03A (upholds SP-PRIV-01):
  The Application MUST pass the delivered handle to the bind call only when
  the user asks to disclose it, and MUST pass an empty handle otherwise.
  The Application MUST set the primary flag only when the user asks to make
  that handle its name. The Application MUST NOT place an account
  identifier in any bind call.
  The rule binds the Application operator, who serves the Application: it
  is the part of the Canonical Runtime that builds the bind call, and an
  operator that serves one breaking this rule is outside ASM-BROWSER-01.
  Necessity: the Prover delivers the handle with every proof and builds no
  bind call, so the choice of sending it falls to the role that does, and
  no Consumer check can tell a handle or a name the user chose to show from
  one an operator sent.
- REQ-PLAT-08D (upholds SP-BIND-01, SP-PRIV-01):
  Where the bind call's handle is nonempty, the Consumer MUST fold it under
  REQ-PLAT-05B and hash it under the platform's handle tag, exactly as for
  a disclosure call (REQ-PLAT-08E), and MUST reject the bind call unless
  that node equals the handle node the Platform Verifier returned
  (common REQ-COMMON-05E). Where the handle is empty, the bind call
  discloses nothing. The Consumer MUST reject a bind call that sets the
  primary flag with an empty handle. The Platform Verifier never receives
  the handle.
  Necessity: the handle arrives beside the proof, not in it, so only the
  node comparison ties it to the account; the verification is what makes
  the node authentic, and with it the canonical form, so the chain needs no
  rule set to check the text. The Consumer already folds and hashes handle
  text for disclosure calls, so one rule serves both. A rejected bind
  protects the display, not the handle: its calldata is public whether or
  not the Consumer accepts it. A primary flag without a handle asks for a
  name the call does not carry.

The Consumer stores every binding under its two nodes. For each node it
records the **owner**, the Transaction Author that last bound it, and the
**watermark**, the `metadataObservedAt` of the binding that last wrote it
(common REQ-COMMON-25A). It also records two pairings: each id node's
current handle node, and each handle node's current id node. A Transaction
Author **holds** a handle on a platform while it owns that handle's node.

- REQ-PLAT-08H (upholds SP-BIND-01, SP-PRIV-01):
  The Consumer MUST key a binding on the id node and the handle node
  themselves. The Consumer MUST NOT key a binding on a plaintext value.
  Necessity: the tags of REQ-PLAT-05C already
  keep every platform's ids and handles apart, and a key that depended on
  more than the node could not be found from a node computed off chain.
- REQ-PLAT-08I (upholds SP-BIND-01, SP-FRESH-01):
  The Consumer MUST reject a Submission whose `metadataObservedAt` is not
  strictly newer than both the id node's watermark and the handle node's
  watermark. On accepting one, the Consumer MUST make the Transaction Author
  the owner of both nodes, set both watermarks to that
  `metadataObservedAt`, and pair the nodes in both directions. When it pairs
  an id node with a handle node other than its previous one, the Consumer
  MUST clear the owner of the previous handle node if that node's current id
  node is still this one, and MUST keep that node's watermark. The Consumer
  MUST NOT change an owner, a watermark, or a pairing on any other path.
  Necessity: an account that proves a new handle has stopped holding the old
  one, and leaving its owner in place would route to the renamed account
  whatever is sent to that handle; a handle another account has since proved
  is that account's, and is left alone. The handle node's own watermark keeps
  evidence older than another account's proof of the handle from taking it
  back, and a retired node keeps its watermark, the time of the last binding
  that wrote it, so that evidence no newer than that binding cannot claim
  it either.
- REQ-PLAT-08O (upholds SP-BIND-01):
  A Consumer that answers whether a handle and an id still go together MUST
  answer yes only when the handle node has an owner and its current paired
  id node is that id node. An id node it has never paired, or a handle node
  without an owner, MUST be answered no. The answer is advice to the caller
  and MUST NOT refuse a transaction. Necessity: a caller holding a handle and
  an id learned at one moment asks whether the same account still holds that
  handle before it pays or links it; two identities of one wallet can pass a
  handle between them, and comparing owners would answer yes to a pair the
  chain no longer holds.

A Transaction Author's **name** is the one handle the Consumer stores for
that author to display, together with the platform the handle is on: the
analogue of an ENS primary name. An author has at most one name across all
platforms, however many identities it holds on one platform or on several.
A handle is **disclosed** once a bind call or disclosure call the Consumer
accepted has carried it; disclosure is history and nothing undoes it. A
handle is **published** while it is its author's name; publication is
state.

- REQ-PLAT-08J (upholds SP-BIND-01):
  The Consumer MUST change a Transaction Author's name only through the
  paths this rule lists. On accepting a bind call that discloses a handle
  with the primary flag set, the Consumer MUST store the handle it folded
  under REQ-PLAT-08D, with the bind call's platform, as the author's name.
  On accepting a publishing call (REQ-PLAT-08E), it MUST store that call's
  folded handle and platform as the caller's name. A stored name replaces
  the name the author had on any platform. On a withdrawal call, the
  Consumer MUST clear the caller's name, whatever its platform. Whenever a
  handle node's owner changes from one author to another, or REQ-PLAT-08I
  clears it, the Consumer MUST clear the previous owner's name if that name
  is on the node's platform and folds to that node. A name on another
  platform stays. The Consumer MUST leave the name unchanged on a bind call
  without the primary flag, whether or not it discloses a handle, and on a
  reveal call. Necessity: a name is the one handle an author chose to show,
  as an ENS primary name is the one name an address shows; a claim of
  another of its identities, or a handle shown without being chosen, must
  not replace that choice, a name left in place after its handle moved would
  show a handle its author no longer holds, and losing a handle on one
  platform says nothing about a handle held on another.
- REQ-PLAT-08K (upholds SP-BIND-01):
  The Consumer MUST store a name folded, with its platform. The Consumer
  MUST answer a read of an author's name with the stored platform and
  handle while the author holds that handle on that platform. The Consumer
  MUST answer that the author has no name when none is stored or the author
  no longer holds the stored handle. Necessity: the platform selects the
  handle tag a reader hashes the name under, and REQ-PLAT-08J clears a name
  on every owner change, so a reader that mirrors the events of
  REQ-PLAT-08F answers the same as the read.
- REQ-PLAT-08E (upholds SP-BIND-01):
  The Consumer MUST offer two disclosure calls, each taking a platform and
  a handle: a publishing call, which makes the handle the caller's name
  (REQ-PLAT-08J), and a reveal call, which shows the handle and changes no
  state. For either, the Consumer MUST fold the handle under REQ-PLAT-05B,
  hash it under the platform's handle tag, and accept the call only when
  the caller holds that node. The Consumer MUST NOT require a new proof or
  the account identifier for a disclosure. The Consumer MUST NOT write
  storage on a reveal call. The Consumer MUST also offer a withdrawal call
  that takes no platform and clears the caller's own name. Necessity: the
  handle's preimage is the evidence and ownership of its node the
  authority. A handle a later claim of the same account renamed away from
  has lost its owner to retirement (REQ-PLAT-08I), so the one test refuses
  it. A reveal lets an author show a handle it holds without making it its
  name. An author has one name, so a withdrawal needs no platform. A
  refused call protects the display, not the handle: its calldata is
  public whether or not the Consumer accepts it.
- REQ-PLAT-08F (upholds SP-BIND-01, SP-PRIV-01):
  The Consumer MUST put no plaintext handle in the event of a binding, and
  MUST put the nodes there. The Consumer, like every other libid contract
  that accepts handle text, MUST emit one shared reveal event, carrying the
  platform, the handle node, and the folded handle and no address, for every
  accepted call that carries handle text. The Consumer MUST put handle text
  in no other event. On the Consumer those calls are a bind call with a
  handle, a publishing call, and a reveal call. The Consumer MUST emit a
  name event carrying the author, the platform, and the handle node for
  every name it stores, after that call's reveal event. The Consumer MUST
  emit an event carrying the author for every name it clears. A stored name
  replaces the earlier one without a clearing event. Necessity: an event
  that carried a handle is public for good; one event for all handle text
  lets a reader build one map from handle node to handle out of every libid
  contract's logs; and a reader mirrors names only if the events say when
  one was stored or cleared. An author has one name, so the author alone
  keys it.

- TEST-PLAT-20A (exercises REQ-PLAT-03A, REQ-PLAT-08D, REQ-PLAT-08E, REQ-PLAT-08F, REQ-PLAT-08H, REQ-PLAT-08J):
  On each platform, a bind call without a handle, made with recognizable
  test values, carries no id, handle, email, or `sub` bytes in its
  calldata, its events, or any storage it writes, including a value split
  across two storage words. The same account bound with
  and without its handle lands on the same two nodes. The Consumer rejects
  a bind call whose handle does not fold to the handle node the Platform
  Verifier returned, the Platform Verifier's result carries no handle, and
  a disclosed handle in another letter case is stored folded. A bind call
  with the primary flag and an empty handle is rejected and writes nothing.
  A bind call with a handle and without the primary flag emits the reveal
  event with the folded handle and leaves the name. A publishing call and a
  reveal call are each rejected from a caller that does not hold the
  handle and for a handle retired by a later claim of the same account, and
  accepted, without a proof, for a held handle given in any letter case. A
  reveal call of a held handle emits the reveal event and writes no
  storage. A bind call with the primary flag and a publishing call each
  emit the reveal event before the name event, and only the reveal event
  carries handle text, and it carries no address. Every other libid
  contract that accepts handle text emits the same reveal event. The
  Application passes the
  handle to the bind call only when the user asks to disclose it, sets the
  primary flag only when the user asks to make it its name, and no
  Submission Payload has a field for a handle or an id.
- TEST-PLAT-20B (exercises REQ-PLAT-08E, REQ-PLAT-08F, REQ-PLAT-08I, REQ-PLAT-08J, REQ-PLAT-08K):
  An identity that proves a new handle leaves its old handle without an
  owner, unless another identity proved that handle meanwhile, which keeps
  it; a retired node keeps its watermark, so evidence older than it binds
  nothing. Evidence not strictly newer than either node's watermark is
  rejected. For a wallet holding identities A and B of one platform with A's
  handle as its name, a claim of B without a handle leaves the name; a claim
  of B disclosing B's handle with the primary flag replaces it. A rename of
  A withdraws A's name; another wallet proving A's handle withdraws it; a
  wallet moving an identity to another wallet withdraws the old wallet's
  name for that handle. For a wallet whose name is its handle on platform P,
  a bind call on platform Q that discloses its Q handle with the primary
  flag, and a publishing call of that Q handle, each replace the name with
  the Q handle and platform Q and emit no clearing event; a bind call on Q
  that discloses nothing, one that discloses the Q handle without the
  primary flag, and a reveal call of the Q handle each leave the name. For a
  wallet whose name is on Q, a rename of its identity on P, and another
  wallet proving its P handle, leave the name. The name reads with its
  platform, and as none whenever its author no longer holds the handle. A
  withdrawal clears the name on whichever platform it is, and emits an event
  only when there was a name.
- TEST-PLAT-20D (exercises REQ-PLAT-08O):
  After an identity proves a handle, the pair of that handle and its id node
  is answered yes. When identity A of a wallet renames and identity B of the
  same wallet then proves A's old handle, the pair with A's id node is
  answered no and the pair with B's is answered yes. An identity that binds
  the same handle from another wallet keeps its pair. An id node never
  bound, and a handle with no owner, are answered no; none of these answers
  refuses a transaction.

### 2.1c The bind operation

The bind call is the Consumer's transaction kind under operation domain
`keccak256(UTF8("libid.bind-identity"))`. Its Authorized Transaction Data
is the target address alone; on EVM, `abi.encode(address)`, 32 bytes
([chain profiles](chain-profiles.md) §3.3). It also takes the service fee
amount and receiver of §2.1b, which no proof commits.

- REQ-PLAT-08P (upholds SP-BIND-01, SP-REPLAY-01):
  The Consumer MUST accept a bind call only under the operation domain
  `keccak256(UTF8("libid.bind-identity"))`. The Consumer MUST reject
  Authorized Transaction Data that is not exactly one target in the Chain
  Profile's encoding. The Consumer MUST reject a bind call whose
  Transaction Author is not that target.
  Necessity: the target is the one value the user authorized, and requiring
  the Transaction Author to be the target leaves a proof usable only by the
  wallet it names.
- REQ-PLAT-08Q (upholds SP-BIND-01):
  The Consumer MUST reject a bind call whose fee amount is zero while its fee
  receiver is nonzero, or whose fee amount is nonzero while its fee receiver is
  the zero address. The Consumer MUST reject a bind call whose native value
  differs from the quotation of common REQ-COMMON-06E plus the fee amount.
  On accepting a bind call with a nonzero fee amount, the Consumer MUST
  transfer exactly that amount to the fee receiver. The Consumer MUST reject
  the bind call when that transfer fails. The Consumer MUST emit an event
  naming the Authorization Digest, the fee receiver, and the amount for every
  fee it transfers. Necessity: the proof authorizes a binding, not a price,
  so the fee stays outside the digest and the Transaction Author agrees to
  it by authoring the call. Exact value needs no refund path, and
  `(0, zero address)` as the only free form leaves no fee without a
  receiver.

- TEST-PLAT-20E (exercises REQ-PLAT-08P, REQ-PLAT-08Q):
  A bind call under another operation domain is rejected. Authorized
  Transaction Data that is not exactly one encoded target, including a
  target followed by a chain identifier, is rejected, and so is a bind call
  whose Transaction Author is not the target. One Submission is accepted by
  the Consumers of two Consumer Chains, once at each, and a second bind call
  of it on either is rejected. A fee amount without a receiver, and a
  receiver without an amount, are rejected. A native value one unit above or
  below the quotation plus the fee amount is rejected. An accepted bind call
  with a fee delivers exactly the amount to the receiver and emits the fee
  event; a receiver that refuses the value rejects the bind call; and a bind
  call without a fee moves exactly the quotation.

### 2.2 Metadata ordering and validity ceilings

Proof validity and mutable-metadata ordering use the authenticated times below.

| Identity platform | Evidence time | `metadataObservedAt` | `proofValidUntil` |
|---|---|---|---|
| Google | signed ID-Token `exp` | evidence time minus `futureObservationAllowance` | evidence time |
| X | the token attestation's signed creation time | evidence time minus `futureObservationAllowance` | evidence time plus `proofLifetime` |
| GitHub | the token-exchange attestation's signed creation time | evidence time minus `futureObservationAllowance` | evidence time plus `proofLifetime` |

The subtraction saturates at zero: an evidence time no greater than the
allowance gives a `metadataObservedAt` of zero.

For X and GitHub, "timestamp" is the signed TLSNotary attestation creation
time. The token attestation is the one-time PKCE and Authorization Digest
binding, so it alone supplies evidence time: one signed timestamp anchors both metadata
ordering and proof validity, exactly as Google's single signed `exp` does.
The identity attestation opens the same bearer and carries the identity
fields; its own creation time is not an evidence-time input and does not
refresh the authorization. `proofLifetime`, `maxFutureAttestationSkew`, and
`futureObservationAllowance` are the
[protocol parameters](libid.md#protocol-parameters) each profile fixes.

Evidence times do not describe the same moment. Google's `exp` runs about an
hour ahead of the token's issue, while a notary stamps its own clock. The
allowance caps how far evidence time may lead Block Time (REQ-PLAT-09A), so
subtracting it keeps `metadataObservedAt` at or below Block Time. The
saturating subtraction never reverses the order of two evidence times under
one profile. `metadataObservedAt` is therefore a conservative watermark, not
the moment of observation. For evidence produced at one moment, a Google
value falls about 3600 seconds before that moment and an X or GitHub value
about 300 seconds before it. The cap matters because a Consumer supersedes
stored metadata only on a strictly newer `metadataObservedAt` (common
REQ-COMMON-25A), so without a cap a longer-lived token would buy a
proportionally longer lock on a name, and re-proving would not supersede it
until Block Time caught up.

Google's signed `exp` alone supplies the accepted one-hour validity value
and, less its allowance, the ordering value. A Google proof also requires its
signing modulus to stay trusted by the Google Key List (§3.4). The Authorization Digest carries no expiration.
`metadataObservedAt` is the monotone metadata watermark of common
REQ-COMMON-25A. Older evidence cannot regress stored metadata and does not
block an otherwise valid authority operation.

- REQ-PLAT-09 (upholds SP-FRESH-01):
  The Platform Verifier MUST reject an X or GitHub token-attestation timestamp
  more than its profile's `maxFutureAttestationSkew` ahead of Block Time.
- REQ-PLAT-09A (upholds SP-FRESH-01):
  The Platform Verifier MUST derive `metadataObservedAt` and
  `proofValidUntil` from the exact sources and arithmetic in the table above
  and from nothing else. The Platform Verifier MUST reject a Submission whose
  evidence time is more than its profile's `futureObservationAllowance` ahead
  of Block Time.

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
authorizationDigest = 0x24083f6c849372d1fa0a95615a7b2b6a888edef92e9fa2bebd520b2f536e9350
Google nonce         = JAg_bISTctH6CpVhWnsraoiO3vkun6K-vVILL1Nuk1A
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
  It requires neither the ID Token nor a new `ProveIdentity` field. The
  projection takes the id node of the delivered `userId`, hashed under
  REQ-PLAT-05A, and the handle node of the delivered `userName`, folded and
  hashed under REQ-PLAT-05B.
- REQ-PLAT-15:
  The Prover MUST reject a Google response carrying `code` or
  `access_token`. Necessity: neither artifact belongs to this
  authentication-only profile.

### 3.3 Proof statement

The Proving Circuit and Consumer enforce all of the following:

- REQ-PLAT-16 (upholds SP-CLIENT-01):
  The Proving Circuit MUST hash the exact ASCII
  `BASE64URL_NOPAD(header) || "." || BASE64URL_NOPAD(payload)` bytes with
  SHA-256. The Proving Circuit MUST verify the signature as
  RSASSA-PKCS1-v1_5 under the exact 2048-bit RSA modulus `n` and the
  profile-fixed exponent `e = 65537`. The Proving Circuit MUST decode the
  claims checked below from that signed payload, not from a detached copy.

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
  modulus is admitted to the trusted set, per REQ-PLAT-70; the JWK encoding
  appears in no signed artifact, so proving it would add nothing.
- REQ-PLAT-16B (upholds SP-BIND-01, SP-CLIENT-01, SP-FRESH-01):
  The Proving Circuit MUST expose exactly the following Google public inputs,
  each derived from the signed payload or verified signing key:

  | Public input | Authenticated source |
  |---|---|
  | Authorization Digest | signed `nonce`, decoded as exactly 32 bytes |
  | client-identifier digest | `SHA256` of the signed `aud` |
  | id node | signed `sub`, hashed per REQ-PLAT-05A |
  | handle node | signed `email`, checked and folded per REQ-PLAT-16D and hashed per REQ-PLAT-05B |
  | evidence timestamp | signed `exp`; the evidence time from which §2.2 derives `metadataObservedAt` and `proofValidUntil` |
  | RSA modulus | exact `n` that verified the JWS; `e = 65537` is profile-fixed |

  The Proving Circuit MUST NOT expose a detached second representation of a
  claim.

The launch `oidc-google` artifact encodes these as 57 field elements: the
digest as 32 one-byte elements (0-31), then each 32-byte digest or node as
`[high, low]` 16-byte big-endian halves, the client-identifier digest at
32-33, the id node at 34-35 and the handle node at 36-37, then `exp` at 38
and the modulus as 18 limbs at 39-56.

- REQ-PLAT-16C (upholds SP-BIND-01, SP-PRIV-01):
  The Proving Circuit MUST NOT expose the signed `sub` or the signed `email`
  in any public input. The Proving Circuit MUST reject a `sub` that
  REQ-PLAT-06 rejects, and MUST hash exactly the signed `sub` bytes under
  REQ-PLAT-05A. Necessity: the `sub` and the `email` stay off the Consumer
  Chain, which leaves the Proving Circuit the only role that sees their
  bytes.
- REQ-PLAT-16D (upholds SP-BIND-01):
  The Proving Circuit MUST admit an `email` only when the check of §2.1a
  admits it, MUST fold it under REQ-PLAT-05B, and MUST hash exactly the
  folded bytes. The Proving Circuit MUST fail to prove, rather than
  truncate, a `sub` longer than 31 bytes or an `email` longer than 62
  bytes. Necessity: neither value holds an escaped byte, since every JSON
  escape begins with `\`, which the check refuses, and the absence of `"`
  keeps the `email` the circuit reads inside its own JSON string.
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
  Proving Circuit MUST check `exp` as a canonical unsigned JSON integer of at
  most 12 decimal digits, and `email_verified` as the exact unquoted JSON
  boolean `true`, under common REQ-COMMON-19D.
  Duplicate-free top-level structure is the issuer's behavior under
  ASM-PROV-06; the circuit performs no search and no duplicate scan.
- REQ-PLAT-22 (upholds SP-FRESH-01):
  The Platform Verifier MUST reject a proof whose signed `exp` places
  `proofValidUntil` at or before Block Time. That `exp` is also the evidence
  time REQ-PLAT-09A holds to at most 7200 seconds ahead of Block Time.

The signing key is fetched from Google's JWKS endpoint (§3.4) as witness input.

- REQ-PLAT-23 (upholds SP-CLIENT-01):
  The Platform Verifier MUST reject a proof whose RSA modulus the Google Key
  List of §3.4 does not trust, or whose trust under REQ-PLAT-72 ends at or
  before Block Time.
- REQ-PLAT-76:
  The Proving Circuit for `("google", 1)` MUST admit each token part up to
  the capacity below. The Proving Circuit MUST fail a token with any part
  beyond it.
  Necessity: a circuit takes fixed-width inputs, so the Platform Ceremony
  Version fixes which tokens can be proven, and every implementation of it
  must admit the same ones.

  | Token part | Capacity |
  |---|---|
  | signing input that REQ-PLAT-16 hashes | 1280 bytes |
  | decoded payload JSON | 768 bytes |
  | `aud` | 128 bytes |
  | `sub` | 31 bytes, per REQ-PLAT-06 |
  | `email` | 62 bytes, per REQ-PLAT-16D |
  | `exp` | 12 decimal digits, per REQ-PLAT-21 |

  A Google client identifier is therefore at most 128 bytes, narrower than the
  512-byte `ProveIdentity.clientId` [wire limit](ccdp.md#wire-limits).

### 3.4 Signing-key lifecycle

Google rotates the keys it signs ID Tokens with and publishes its current
set, which in practice includes the key it will sign with next, at
`https://www.googleapis.com/oauth2/v3/certs`. The Platform Verifier reads its
trusted Google modulus set from a Google Key List: a ledger component the
Verifier Governance Process selects for it, which admits moduli only from
notarized readings of that endpoint. A reading is one TLSNotary session,
authenticated under common §9.1 by the Notary Service the Google Key List
pins, with both directions wholly revealed. Anyone may submit a reading, and
each admitted reading pays that Notary Service one Notary Fee. Google Submissions
still reach no Notary Service and pay no fee. The Google Key List keeps two
generations, each one reading's key set and creation time. Trust in a
generation lapses with time, with no transaction from anyone, and ends
sooner once two readings that each change the set follow it.

| Constant | Value | Meaning |
|---|---|---|
| reading authority | `www.googleapis.com` | the attested TLS server name, and the one `Host` value |
| reading request line | `GET /oauth2/v3/certs HTTP/1.1` | the request's first line, through its CRLF |
| maximum reading lead | 300 s | how far a reading's creation time may run ahead of Block Time |
| maximum reading age | 3600 s | how far a reading's creation time may trail Block Time |
| generation lifetime | 2592000 s (30 days) | the longest a generation stays trusted after its reading's creation time |
| key limit | 8 | the most keys one reading may carry |
| modulus length | 256 bytes | the decoded `n` of every key: an RSA-2048 modulus |
| public exponent | `AQAB` | the `e` of every key: 65537 |
| renewal margin | 604800 s (7 days) | remaining trust at or below which the Google Key List reports a reading is due |

- REQ-PLAT-24 (upholds SP-BIND-01):
  The Google Key List MUST admit a modulus only from a reading the Notary
  Service it pins accepts. The Google Key List MUST reject a reading whose
  attested TLS server name is not the reading authority. The Google Key List
  MUST reject a reading whose request does not begin with the reading request
  line, has a line ending other than CRLF or a folded line, or does not carry
  exactly one `Host` header in its head with the reading authority as its
  value. The Google Key List MUST reject a reading in which either direction
  carries a range commitment or a byte outside its revealed ranges.
  Necessity: the notary vouches that the bytes crossed a TLS session to the
  authority, not which of the host's virtual backends answered or what the
  request asked. The `Host` header pins the backend, the whole request line
  keeps out a query such as `?callback=` that would make the body bytes the
  requester chose, and a wholly revealed transcript leaves no hidden range to
  hold a second `Host` header or a decoy `keys` member.
- REQ-PLAT-70 (upholds SP-BIND-01):
  The Google Key List MUST reject a reading whose response does not begin
  with `HTTP/1.1 200 `, declares a `Content-Encoding`, carries more than one
  framing header, frames with a `Transfer-Encoding` other than `chunked`, or
  declares a `Content-Length` other than the body length. The Google Key
  List MUST reject a body in which the token `"keys"` does not occur exactly
  once, or is not followed by a colon, an array of one to the key limit of
  flat JWK objects, and then only the closing brace and whitespace. The
  Google Key List MUST reject a key whose `kid`,
  `n`, or `e` is not exactly one string without escapes. The Google Key List
  MUST reject a key whose `e` is not the public exponent or whose `n` does
  not base64url-decode to the modulus length. The Google Key List MUST reject
  a reading that lists one modulus twice. Necessity: the Platform Verifier
  trusts a key by its modulus alone, and the circuit verifies RS256 under a
  2048-bit modulus and the exponent 65537. A key published under any other
  exponent or size would be trusted for a signature the circuit never checks.
- REQ-PLAT-71 (upholds SP-BIND-01):
  The Google Key List MUST reject a reading whose attested creation time is
  more than the maximum reading lead ahead of Block Time. The Google Key List
  MUST reject a reading whose attested creation time is more than the maximum
  reading age behind Block Time. The Google Key List MUST reject a reading
  whose creation time is not strictly later than the current generation's.
  Necessity: a reading names no contract and rotation is open, so anyone can
  replay any reading on any chain. The age bound and the strict order keep an
  old reading from restoring a key set Google has dropped or from restarting
  a generation's lifetime.
- REQ-PLAT-72 (upholds SP-BIND-01):
  When an admitted reading lists the same set of moduli as the current
  generation, the Google Key List MUST restart the current generation from
  that reading's creation time and leave the previous generation unchanged.
  When an admitted reading lists a different set, the Google Key List MUST
  make the current generation the previous one, discard the generation that
  was previous, and make the reading the current generation. The Google Key
  List MUST trust a modulus that either generation lists until one generation
  lifetime after the creation time of the later generation that lists it. The
  Google Key List MUST NOT trust a modulus from that time on, or one neither
  generation lists. Necessity: a token minted under a key Google has just
  dropped is presented for the rest of its hour, and the previous generation
  covers it. Trust that lapses by time retires a key Google stopped publishing
  with no transaction from anyone, and 30 days is runway for a submitter
  outage, not a key's life. The generation lifetime bounds trust and does not
  promise it: the second reading that changes the set after the latest reading
  listing a modulus discards that modulus at once. This hits a modulus that
  unexpired tokens still use when two such readings land within their hour, as
  when Google's servers serve three different sets at once during a rotation.
  Valid Google proofs under it are then rejected until a reading lists it
  again, and for good once Google stops listing it. That loss is the cost of
  keeping only two generations.
- REQ-PLAT-73 (upholds SP-BIND-01):
  The Google Key List MUST NOT expose an operation, other than admitting a
  reading or an upgrade by the Verifier Governance Process, that adds,
  removes, or re-dates a modulus. The Verifier Governance Process MUST own
  the selection of the Google Key List each Platform Verifier of a Google
  profile reads, the selection of the Notary Service that Google Key List
  pins, and any upgrade of the Google Key List. Necessity: readings, not
  governance, decide which Google keys are trusted. Short of upgrading the
  Google Key List or the Platform Verifier, governance can end trust in a set
  before the set lapses only by selecting another Google Key List or retiring
  every Verifier Version of the profile.

Rotation is permissionless: any party can restore Google ceremonies with a
reading that lists the key Google signs with, paying its Notary Fee. That
permits recovery, not uninterrupted availability. Availability assumes that
Google lists a key before it signs with it and that a reading listing the key
lands in between. It also assumes that a reading lands at least once per
generation lifetime and that no two readings discard a modulus still in use
(REQ-PLAT-72). Nothing guarantees the lead:
[OIDC §10.1.1](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys)
lets a signer start using a new key at its discretion. Until a reading that
lists a newly signing key lands, valid Google proofs under it are rejected.
The Google Key List reports when its current generation has at most the
renewal margin of trust left, so a submitter can renew well before the lapse.

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
  authoritative, and malformed fields. The Prover MUST treat a `code` as
  malformed unless, decoded once as `application/x-www-form-urlencoded`, it
  is 1 to 1024 bytes, each in `0x21` through `0x7e`. The single accepted
  `code` is the code consumed at redirect ingress that REQ-PLAT-29 and
  REQ-PLAT-46 compare against. GitHub's required `iss` under REQ-PLAT-34A is
  a profile field, not an additional authoritative field to reject.
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

### 4.1 Attested data

Common REQ-COMMON-18 has every profile with a nonzero Attestation Count fix
its attestation format. The X and GitHub profiles fix the same one: the record
and signature below. The Notary Service writes one record per notarized
session and signs it. The Platform Verifier holds no transcript and reads
every field it checks out of that record. Every range commitment §5 and §6
name is the commitment this section defines.

The record, `attestedData`, is a 48-byte header, then the sent (request)
direction block, then the received (response) direction block, which ends the
record. Every integer is unsigned and big-endian at the width shown.
No field is padded, aligned, or tagged.

| Offset | Bytes | Field | Value |
|---|---|---|---|
| 0 | 32 | `authorityId` | keccak256 of the authority bytes of [common §9](ceremony-common.md#9-notarized-transcripts-and-attestation-verification): the lowercase ASCII TLS server DNS name the Notary Service authenticated, with no trailing dot |
| 32 | 8 | `createdAt` | Unix seconds on the Notary Service's own clock when the session completed; the signed creation time of §2.2 |
| 40 | 4 | `sentTranscriptLength` | total bytes of the request direction; a signed length of common REQ-COMMON-36 |
| 44 | 4 | `recvTranscriptLength` | total bytes of the response direction; a signed length of common REQ-COMMON-36 |
| 48 | variable | sent direction block | the request direction's ranges |
| after the sent block | variable | received direction block | the response direction's ranges |

The record names no platform, session, chain, or verifier. The Platform
Verifier tells a token session from an identity session by the revealed
request line it compares under common REQ-COMMON-21A.

A direction block lists its revealed ranges, then its range commitments:

| Field | Bytes | Value |
|---|---|---|
| revealed count | 8 | number of revealed ranges that follow |
| revealed range `start` | 4 | offset of the range's first byte |
| revealed range `length` | 8 | number of revealed bytes; the range ends at `start + length` |
| revealed range bytes | `length` | the revealed transcript bytes |
| commitment count | 8 | number of range commitments that follow |
| commitment `start` | 4 | offset of the committed range's first byte |
| commitment `end` | 4 | offset one past the committed range's last byte |
| commitment value | 32 | the range commitment below |

The revealed ranges follow their count one after another, each as its
`start`, `length` and bytes in that order. The commitments follow their count
the same way, each as its `start`, `end` and value. Offsets are zero-based
into that direction's transcript. A revealed range carries no `end`: its byte
count is its length.

A range commitment covers one contiguous range of one direction:

```text
commitment = SHA-256(plaintext || blinder)
```

`plaintext` is that direction's transcript bytes `[start, end)`, and
`blinder` is the 16 bytes common REQ-COMMON-44 draws for the commitment. No
length prefix, separator, or domain tag enters the hash. In the X and GitHub
profiles the Proving Circuit opens four commitments: the bearer ranges of the
token session and the identity request, and the id and handle ranges of the
identity response (REQ-PLAT-32D, REQ-PLAT-52C).

The Notary Service signs the record under [EIP-191] version `0x45`, with the
32-byte digest as the message:

```text
digest     = keccak256(attestedData)
signedHash = keccak256(0x19 || "Ethereum Signed Message:\n32" || digest)
signature  = r || s || v
```

`signature` is a secp256k1 ECDSA signature over `signedHash`: `r` and `s`
are 32 bytes each, big-endian, and `v` is one byte. A notary key is
identified by its address, the last 20 bytes of keccak256 of the 64-byte
uncompressed public key. The Notary Service returns the attested data and
the signature as a pair; the Prover carries both unchanged into the
Submission, and the Platform Verifier hands that pair to the Notary Service
under common REQ-COMMON-33.

Verifying a record checks its signature and its shape. Whether the ranges
tile a direction, and which revealed bytes anchor a commitment, are the
Platform Verifier's checks under common REQ-COMMON-18A and REQ-COMMON-35.

- REQ-PLAT-64 (upholds SP-BIND-01, SP-EXCHANGE-01):
  The Notary Service MUST encode the attested data of every X and GitHub
  session in exactly the layout above, with each integer unsigned and
  big-endian at its stated width and no byte before, between, or after the
  fields. Necessity: the Platform Verifier reads each field at the offset
  the bytes before it imply, so a record in any other layout reads as fields
  the notary never signed.
- REQ-PLAT-65 (upholds SP-BIND-01, SP-FRESH-01):
  The Notary Service MUST set `authorityId` to keccak256 of the canonical
  authority bytes of the server name it authenticated under common
  REQ-COMMON-21. The Notary Service MUST set `createdAt` from its own clock
  when the session completes. The Notary Service MUST set each transcript
  length to the total bytes it observed in that direction. The Notary
  Service MUST write each maximal run of revealed bytes as one revealed range.
  The Notary Service MUST order revealed ranges and commitments by ascending
  `start`. Necessity: the Platform Verifier compares `authorityId` with
  keccak256 of its pinned authority, so another spelling of the same host
  names an authority no profile pins; and the Prover compares the signed
  ranges with its planned ranges one for one.
- REQ-PLAT-66 (upholds SP-EXCHANGE-01):
  The Implementation MUST compute every range commitment as SHA-256 over the
  committed transcript bytes followed directly by a 16-byte blinder, one
  contiguous range per commitment. The Proving Circuit MUST open a range
  commitment by recomputing exactly that construction from its private
  plaintext and blinder. Necessity: common REQ-COMMON-38 pins the hash but
  not its preimage, and a circuit placing or sizing the blinder differently
  opens no commitment the session produced.
- REQ-PLAT-67 (upholds SP-EXCHANGE-01):
  The Notary Service MUST sign the [EIP-191] version `0x45` message whose
  content is the 32-byte `keccak256(attestedData)` with a secp256k1 key. The
  Notary Service MUST encode that signature as the 65 bytes `r || s || v`,
  with `s` at most half the secp256k1 group order, rounded down, and `v`
  equal to 27 or 28. The Notary Service MUST return the attested data byte
  for byte as it signed it, together with that signature. Necessity: the
  verifying side recomputes the digest from the bytes it is handed, so a
  record re-encoded on the way, or signed under another scheme, recovers a
  key nobody trusts.
- REQ-PLAT-68 (upholds SP-EXCHANGE-01):
  The Notary Service MUST compute the digest from the attested data handed to
  it, recover the signer's address from the signature over that digest's
  EIP-191 hash, and compare that address with the keys it holds as trusted
  under common REQ-COMMON-33A. The Notary Service MUST reject a signature
  that is not 65 bytes, whose `s` exceeds half the group order, whose `v` is
  not 27 or 28, or from which no public key recovers. Necessity: a digest
  taken from the caller authenticates whatever the caller hashed, per common
  REQ-COMMON-33, and the encoding checks accept exactly the form REQ-PLAT-67
  produces and no malleated twin of it.
- REQ-PLAT-69 (upholds SP-EXCHANGE-01):
  The Notary Service MUST reject attested data that ends inside a field,
  carries a byte after the received direction block, or holds a direction
  block with an empty range, a range starting before the previous range of
  its list ends, a range ending past its direction's signed transcript
  length, or a commitment overlapping a revealed range. Necessity: a suffix
  is a second message riding on the first signature; a byte inside two
  ranges has two readings, or is both read and hidden; and a range past the
  signed length describes bytes the session never carried.

Conformance vector, with placeholder commitment values and a sent direction
laid out as an identity request (revealed, committed bearer, revealed):
authority `api.x.com`, `createdAt` 1770000000, transcript
lengths 60 and 40, sent ranges `[0, 20)` and `[40, 60)` revealed around a
commitment over `[20, 40)`, and received range `[0, 10)` revealed before a
commitment over `[10, 40)`. `attestedData` is the 246 bytes below with the
labels and spaces removed:

```text
header    4930142f5283d4a8eab0d24c588f00b21213ae2a47e7ed6c1dc6a57044f1655d
          0000000069800e80 0000003c 00000028
sent      0000000000000002
          00000000 0000000000000014 6161616161616161616161616161616161616161
          00000028 0000000000000014 6262626262626262626262626262626262626262
          0000000000000001
          00000014 00000028 0707070707070707070707070707070707070707070707070707070707070707
received  0000000000000001
          00000000 000000000000000a 63636363636363636363
          0000000000000001
          0000000a 00000028 0909090909090909090909090909090909090909090909090909090909090909
digest    0x48162f05bdb27b19b3544bf2aae608745861bf357bb31e07f536b6fb50e95936
```

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
  printable ASCII of at most 128 bytes. The carriage-return and line-feed
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
  encoding of exactly 32 bytes for `code_verifier`. Within this body grammar,
  `code` and `redirect_uri` are nonempty values with no further constraint:
  the Platform Verifier reads neither and judges only their bytes under
  REQ-COMMON-07A, and the Canonical Runtime compares them with the values it
  serialized under REQ-PLAT-29 and REQ-PLAT-29C. REQ-PLAT-28 bounds the
  `code` itself at redirect ingress. The `grant_type` value is the exact ASCII
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

Every token-session byte the table below does not reveal stays behind a
[§4.1](#41-attested-data) range commitment. The Proving Circuit opens only
the bearer range and constrains its charset under REQ-PLAT-30. Per common
§9, the token session reveals exactly these ranges:

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
  notarized token session as a [§4.1](#41-attested-data) range
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

`GET https://api.x.com/2/users/me` with no query and no body. The request
carries these four headers, in any order, and may carry others:
`authorization: Bearer <access_token>`, `accept: application/json`,
`host: api.x.com`, and `connection: close`. The Platform Verifier compares
the request line, the `authorization` line, and the `host` line under common
REQ-COMMON-39D, refuses the names common REQ-COMMON-39B forbids, and
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

The response direction reveals only the anchors around the two identity
values. Each value is its own committed range, and every other response
byte stays behind a [§4.1](#41-attested-data) range commitment:

| Range | Revealed | Why |
|---|---|---|
| `"id":"` and, after the value, its closing quote | yes | anchor the committed `id` range per REQ-PLAT-31 |
| the `data.id` value | committed | its own range commitment, opened only in circuit (REQ-PLAT-32D) |
| `"username":"` and, after the value, its closing quote | yes | anchor the committed `username` range per REQ-PLAT-31 |
| the `data.username` value | committed | its own range commitment, opened only in circuit (REQ-PLAT-32D) |
| everything else | no | status line, headers, display name, and every other response field |

Every committed range of this direction is bounded by a revealed delimiter
on each side that faces one, and by the signed transcript boundary of common
REQ-COMMON-36 at the two ends, which is the anchoring common REQ-COMMON-18A
requires.

- REQ-PLAT-59 (upholds SP-BIND-01, SP-PRIV-01):
  The Implementation MUST reveal the full `"id":"` and `"username":"`
  delimiters and their closing quotes in the `/2/users/me` response, and
  MUST commit each value, exactly the bytes between its delimiter and its
  closing quote, as its own range. The Implementation MUST redact every
  other response byte behind a range commitment. Necessity: the anchors are
  what tell the Platform Verifier which commitments hold the identity, and a
  revealed value would put the id and handle on the Consumer Chain.
- REQ-PLAT-31 (upholds SP-BIND-01):
  The Platform Verifier MUST find the `id` commitment and the `username`
  commitment by their anchors: for each field, the one range commitment
  that starts where a revealed range ending with the full `"field":"`
  delimiter ends, and that is followed by a revealed `"`. The Platform
  Verifier MUST reject a transcript in which either delimiter matches at
  more than one position of the revealed bytes, per common REQ-COMMON-19A,
  or in which no commitment, or more than one, is so framed. The Platform
  Verifier MUST pass those two commitments to the proof as REQ-PLAT-32B
  fixes. Necessity: the response carries account-holder-influenced text,
  such as the display name, that can embed a lookalike field. A second copy
  of a delimiter hidden inside a committed range is invisible to that scan;
  ASM-PROV-06 is what excludes it.
- REQ-PLAT-31A (upholds SP-BIND-01):
  On X and on GitHub, the Prover MUST derive the `userId` and raw handle
  from the bytes of the id and handle commitments the platform's framing
  rule (REQ-PLAT-31, REQ-PLAT-51) finds, which are the bytes it opens in
  the proof, and MUST copy them, never through a number parse. The Proving
  Circuit's opening is the authoritative extraction under common
  REQ-COMMON-19E; the Prover's is the repeat it permits. The Proving
  Circuit MUST NOT expose a second independently supplied representation
  of either identity field. Before delivery, the Prover MUST require the
  proof's id node and handle node public inputs to equal the id node of
  the `userId` and the handle node of the raw handle it delivers, under
  REQ-PLAT-05A and REQ-PLAT-05B with the platform's tags.
- REQ-PLAT-32 (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST assert that one private bearer value opens the
  bearer commitment of the token attestation and the `Authorization` bearer
  commitment of the `/2/users/me` attestation. The two commitment values
  differ, because common REQ-COMMON-44 draws an independent blinder for each
  notarized session.
- REQ-PLAT-32A (upholds SP-EXCHANGE-01):
  The Implementation MUST commit the `Authorization` bearer range of the
  notarized identity session as a [§4.1](#41-attested-data) range
  commitment. The Implementation MUST keep the plaintext token bytes
  redacted. Necessity: each notarized session carries its own blinder, so the
  same bearer commits to two different values. Nothing outside a proof can
  tell that they open to one bearer, which is the reason a circuit exists at
  all.

- REQ-PLAT-32D (upholds SP-BIND-01):
  The Proving Circuit MUST open the id commitment and the handle commitment
  of the `/2/users/me` attestation to the raw `id` and `username` values,
  check them under §2.1a, and prove the id node and handle node of
  REQ-PLAT-05A and REQ-PLAT-05B over exactly those opened bytes, folding
  the handle from the same witness that opened its commitment. X and GitHub
  prove under one bearer-link circuit, which hashes under the two tags its
  public inputs carry. Necessity: the values stay committed (§5.3), so the
  circuit is the only role that sees them; and the Platform Verifier, not
  the prover, supplies the tags (REQ-PLAT-32C), so a proof made under one
  platform's tags fails under another's.
- REQ-PLAT-32B (upholds SP-EXCHANGE-01, SP-BIND-01):
  The Proving Circuit MUST expose exactly these sixteen public inputs, each
  32-byte value as two field elements holding its high and low 16 bytes,
  big-endian, high first, and each tag as one field element holding its
  bytes from the top of 31 bytes, zero after, followed by its length:

  | Index | Public input | Meaning |
  |---|---|---|
  | 0-1 | token bearer commitment | the commitment the Platform Verifier matches against the verified token attestation |
  | 2-3 | identity bearer commitment | the bearer commitment the Platform Verifier matches against the verified `/2/users/me` attestation |
  | 4-5 | id commitment | the `id` commitment the Platform Verifier frames in that attestation's response |
  | 6-7 | handle commitment | the `username` commitment the Platform Verifier frames in that response |
  | 8-9 | id node | REQ-PLAT-05A over the opened `id` |
  | 10-11 | handle node | REQ-PLAT-05B over the opened `username` |
  | 12-13 | user-id tag, its length | X's user-id tag of REQ-PLAT-05C |
  | 14-15 | handle tag, its length | X's handle tag of REQ-PLAT-05C |

  The Proving Circuit MUST keep the bearer, the id, and the handle private.
  The Proving Circuit MUST NOT add an Authorization Digest, client
  identifier, timestamp, or endpoint public input.
- REQ-PLAT-32C (upholds SP-EXCHANGE-01, SP-BIND-01):
  The Platform Verifier MUST take the two nodes from the Submission
  Payload, MUST verify the proof against public inputs it builds from the
  four commitments in the attestations it verified, those two nodes, and
  its own platform's two tags, and MUST return the nodes only from a proof
  that verifies. Necessity: built from the attestations and the verifier's
  platform, the inputs leave the circuit no way to prove a link between two
  attestations other than the ones submitted, nodes of values other than
  the ones the platform sent, or nodes under another platform's tags; a
  node the payload names wrongly is a proof that does not verify.

The circuit proves two things: one hidden bearer opens both attestations'
bearer commitments, and the committed id and handle, each one whole JSON
token, hash to the two nodes under X's tags. Everything else is checked where it can be seen — the
Platform Verifier binds the Authorization Digest by recomputing the verifier
under common REQ-COMMON-15A, reads the client identifier, evidence timestamp,
request method, and path from revealed attestation bytes, frames the id and
handle commitments by their revealed anchors, and takes each session's
authority from the TLS server identity that session's attestation
authenticates. The circuit carries no copy of any of them, because a fact
that can be checked in the open does not belong in a proof.

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

As on X, the evidence is two attestations and one hidden bearer linking
them, and the circuit opens the committed id and handle. GitHub proves under
X's bearer-link circuit, with GitHub's tags as its tag inputs.
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
  encoding of exactly 32 bytes for `code_verifier`. Within this body grammar,
  `code`, `redirect_uri` and `client_secret` are nonempty values with no
  further constraint: the Platform Verifier reads none of them and judges
  only their bytes under REQ-COMMON-07A, and the Prover compares `code` and
  `redirect_uri` with the values it serialized under REQ-PLAT-46 and
  REQ-PLAT-48A. REQ-PLAT-28 bounds the `code` itself at redirect ingress.
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
  reveals it; the circuit's public inputs are commitments and nodes, not
  duplicated request fields.
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
  printable ASCII of at most 128 bytes. The Proving Circuit MUST verify no
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
- REQ-PLAT-55 (upholds SP-CLIENT-01, SP-PRIV-01):
  On X and GitHub, the Canonical Runtime MUST treat the bearer commitment
  opening, and the openings, value and blinder, of the id and handle
  commitments of REQ-PLAT-59 and REQ-PLAT-60, as private witness material
  for the Proving Circuit. The Canonical Runtime MUST NOT include any of
  those openings in a Submission, log, or published artifact. The id and
  handle values alone travel as the delivered identity (REQ-PLAT-31A) and,
  when the user asks, the handle as the disclosed one (REQ-PLAT-03A); an
  opening, value with its blinder, never does.
  Necessity: publishing the bearer's opening defeats the commitment's
  protection against guessing the bearer, and an id or handle opening is
  the plaintext id or handle, which the commitment keeps off the Consumer
  Chain unless the user discloses the handle.

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

Every unrevealed range stays behind a [§4.1](#41-attested-data) range
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

`GET https://api.github.com/user` with no query and no body. The request
carries these six headers, in any order, and may carry others:
`authorization: Bearer <access_token>`, `accept: application/vnd.github+json`,
`x-github-api-version: 2022-11-28`, `host: api.github.com`,
`connection: close`, and a `user-agent` of the Canonical Runtime's choosing,
which GitHub requires of every API request and answers `403` without. The
Platform Verifier compares the request line, the `authorization` line, and
the `host` line under common REQ-COMMON-39D, refuses the names common
REQ-COMMON-39B forbids, and compares no other header.

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

The response direction reveals only the anchors around the two identity
values. Each value is its own committed range, and every other response
byte stays behind a [§4.1](#41-attested-data) range commitment:

| Range | Revealed | Why |
|---|---|---|
| `"id":` and, after the digits, the structural byte that ends them, `,` or `}` | yes | anchor the committed `id` range and prove it is the whole number per REQ-PLAT-51 |
| the `id` integer token's digits | committed | its own range commitment, opened only in circuit (REQ-PLAT-52C) |
| `"login":"` and, after the value, its closing quote | yes | anchor the committed `login` range per REQ-PLAT-51 |
| the `login` value | committed | its own range commitment, opened only in circuit (REQ-PLAT-52C) |
| everything else | no | status line, headers, and every other response field |

Every committed range of this direction is bounded by a revealed delimiter
on each side that faces one, and by the signed transcript boundary of common
REQ-COMMON-36 at the two ends, which is the anchoring common REQ-COMMON-18A
requires.

- REQ-PLAT-60 (upholds SP-BIND-01, SP-PRIV-01):
  The Implementation MUST reveal the full `"id":` delimiter and the
  structural byte after the integer token, together with the full
  `"login":"` delimiter and its closing quote, in the `/user` response. The
  Implementation MUST commit the `id` digits and the `login` value each as
  its own range. The Implementation MUST keep the JSON whitespace GitHub puts
  inside either member in a revealed range, per common REQ-COMMON-19F, and
  out of the committed value. The Implementation MUST redact every other
  response byte behind a range commitment. Necessity: the anchors are what
  tell the Platform Verifier which commitments hold the identity, and a
  revealed value would put the id and handle on the Consumer Chain.
- REQ-PLAT-51 (upholds SP-BIND-01):
  The Platform Verifier MUST find the `id` commitment and the `login`
  commitment by their anchors, as REQ-PLAT-31 does: the one commitment that
  starts where a revealed range ending with the full delimiter ends, and
  that is followed, for `login`, by a revealed `"`, and for `id`, by a
  revealed range starting at the commitment's end whose first byte after
  the removal common REQ-COMMON-19F fixes is `,` or `}`. The GitHub profile
  fixes that structural byte as `,` or `}` and no other byte. The Platform
  Verifier MUST reject a transcript in which either delimiter matches at
  more than one position of the revealed bytes, per common REQ-COMMON-19A, or in which no
  commitment, or more than one, is so framed. That the committed `id` bytes
  are digits is the Proving Circuit's to check under REQ-PLAT-06.
  The Prover derives the GitHub identity from those two commitments under
  REQ-PLAT-31A.
  Necessity: the terminator is what proves the committed digits are the
  whole number rather than a prefix of a longer one, and JSON member order
  does not guarantee which of the two closes it.
- REQ-PLAT-52 (upholds SP-EXCHANGE-01):
  The Proving Circuit MUST assert that one private bearer value opens the
  bearer commitment of the token-exchange attestation and the
  `Authorization` bearer commitment of the `/user` attestation. The Platform Verifier MUST
  compare the method and path revealed in each attestation, and
  the authority each attestation authenticates, with the GitHub profile.

- REQ-PLAT-52C (upholds SP-BIND-01):
  The Proving Circuit MUST open the id commitment and the handle commitment
  of the `/user` attestation to the raw `id` digits and `login` value, and
  prove their nodes as REQ-PLAT-32D does, under GitHub's tags.
- REQ-PLAT-52A (upholds SP-EXCHANGE-01, SP-BIND-01):
  The Proving Circuit MUST expose exactly the sixteen public inputs of
  REQ-PLAT-32B, in its order and encoding, with the token-exchange
  attestation in place of X's token attestation, the `/user` attestation in
  place of `/2/users/me`, `login` in place of `username`, and GitHub's tags in
  place of X's. The Proving
  Circuit MUST NOT add an Authorization Digest, client identifier,
  timestamp, or endpoint public input. Necessity: the digest is bound by the
  Platform Verifier under common REQ-COMMON-15A, and the rest are revealed
  bytes it reads directly, so a circuit copy would be a second
  representation of a fact that already has one.
- REQ-PLAT-52B (upholds SP-EXCHANGE-01, SP-BIND-01):
  The Platform Verifier MUST build the public inputs as REQ-PLAT-32C does,
  with GitHub's tags. Necessity: as REQ-PLAT-32C.

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
user-ID namespace; its user-id and handle tags under REQ-PLAT-05C, none a
prefix of any other tag and no other tag a prefix of them, and its
circuit's buffers, as its entry in the circuits' platform table, with
vectors in the shared table (§2.1a); how the id and handle reach that circuit without being revealed; authenticated
observation ordering; client portability or a bounded client family; exact
authorization and redirect transport; every authenticated request and
response field with its provenance; how the Authorization Digest is carried
through that platform's authorization; its authenticated client-binding source; an
authenticated proof-validity rule and the value of each protocol parameter it
names; its trust-root lifecycle;
browser and deployment data exposure, retry, interruption, and withholding
behavior; and conformance vectors.

## 8. Conformance

Roles: Canonical Runtime (including Prover), Proving Circuit,
Platform Verifier, Google Key List, Notary Service, Consumer.

- TEST-PLAT-01 (exercises REQ-PLAT-10, REQ-PLAT-18):
  The §3.1 nonce vector reproduces exactly. A proof bound to another token
  nonce is rejected downstream when verified against this authorization's
  recomputed digest, independently of the browser result-consistency checks.
- TEST-PLAT-02 (exercises REQ-PLAT-05A, REQ-PLAT-05B, REQ-PLAT-05C, REQ-PLAT-06):
  The §2.1 id and handle node vectors reproduce, and each listed malformed
  identifier fails to prove: an X or GitHub id holding a non-digit, a space
  before it, or more than 20 digits, while `0123` proves as sent; and a
  Google `sub` of 32 bytes or holding `"`, `\`, or a tab, while one with a
  leading `0` proves unchanged.
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
- TEST-PLAT-06 (exercises REQ-COMMON-19D, REQ-PLAT-16, REQ-PLAT-16A, REQ-PLAT-16B, REQ-PLAT-16C, REQ-PLAT-16D, REQ-PLAT-17, REQ-PLAT-19, REQ-PLAT-19A, REQ-PLAT-20, REQ-PLAT-21, REQ-PLAT-23, REQ-PLAT-76):
  The browser Prover rejects an audience differing from its frozen client.
  A token with a foreign issuer, `email_verified: false`, a
  quoted or non-boolean `email_verified`, a quoted, negative, fractional,
  exponent, leading-zero, or 13-digit `exp` cannot satisfy the circuit.
  A signature incompatible with the fixed RS256 relation or supplied modulus
  likewise fails the circuit. Substitution of signed header/payload bytes or
  signature invalidates that relation; public-output substitution fails proof
  verification downstream. These are not separate browser proof-verification
  requirements. A cryptographically valid proof under an inactive signing modulus passes
  circuit verification but is rejected by the Platform Verifier. A submission
  whose supplied `aud` bytes do not hash to the audience public input is
  rejected, and an accepted one returns those exact bytes as the client
  identifier. A token whose `sub` is empty, longer than 31 bytes, or
  carries `"`, `\`, or a byte outside `0x20` through `0x7e` fails the
  Proving Circuit, as does an `email` that carries `"` or `\` or is
  longer than 62 bytes. An `email` with a space or an `@` anywhere proves
  as sent.
  `A.B+tag@Example.COM` and `a.b+tag@example.com` prove the same handle
  node, the §2.1 vector, and no public input carries a `sub` or `email`
  byte. A token whose parts each sit at their REQ-PLAT-76 capacity proves;
  a token with any part beyond its capacity fails.
- TEST-PLAT-07 (exercises REQ-PLAT-22, REQ-PLAT-09, REQ-PLAT-09A):
  A proof at or after `proofValidUntil`, a token-attestation creation time
  more than its profile's `maxFutureAttestationSkew` ahead of Block Time, and
  a Google `exp` more than 7200 seconds ahead of Block Time are rejected. An X
  or GitHub identity-attestation timestamp changes neither
  `metadataObservedAt` nor `proofValidUntil`. An accepted Google proof returns
  its signed `exp` minus 7200 as `metadataObservedAt` and expires at that
  `exp`. An accepted X or GitHub proof returns its token-attestation creation
  time minus 300 as `metadataObservedAt` and expires 3600 seconds after that
  creation time. An
  evidence time no greater than its profile's allowance returns zero.
- TEST-PLAT-08 (exercises REQ-PLAT-24, REQ-PLAT-70):
  A notarized reading of Google's live JWKS endpoint is admitted, and the
  trusted modulus set then holds every modulus published there, each with
  exponent 65537. A reading is rejected when its attested authority is
  another host, its request line differs or carries a query, its request
  has a bare CR or LF, a folded line, or no, two, or a foreign `Host`
  header, or either direction commits a range. A reading is also rejected
  when its status is not 200, its body is encoded, doubly framed, or
  mis-sized, its key set is empty, holds more than 8 keys, or repeats a
  modulus, or a key has an exponent other than `AQAB` or a modulus other
  than 256 bytes.
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
- TEST-PLAT-10 (exercises REQ-PLAT-30, REQ-PLAT-31, REQ-PLAT-32, REQ-PLAT-32D, REQ-PLAT-36, REQ-PLAT-51, REQ-PLAT-52, REQ-PLAT-52C):
  An opened bearer range of 128 printable ASCII bytes proves; one that is
  empty, over 128 bytes, or outside printable ASCII fails to prove; an
  identity response with no framed `id` or handle commitment is rejected; a
  proof whose two attestations commit different bearers is rejected; an
  opened id or handle that is not one JSON token fails to prove; a proof
  under the other launch platform's tags is rejected; and an id node or
  handle node that is not the node of the opened value fails to prove,
  including one off by one in its low half. No proof
  statement covers `token_type` or the granted scope.
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
- TEST-PLAT-15A (exercises REQ-PLAT-52, REQ-PLAT-52A, REQ-PLAT-52B, REQ-PLAT-52C):
  A GitHub proof whose bearer, id, or handle commitment public input differs
  from the commitment in either submitted attestation is rejected;
  substituting one attestation for another from a different ceremony is
  rejected; swapping the id node and the handle node, or giving another
  identity's nodes, is rejected; and the proof carries no bearer, code,
  verifier, redirect URI, id, handle, time, client, or endpoint public input.
  An X proof submitted to the GitHub Platform Verifier is rejected.
- TEST-PLAT-15B (exercises REQ-PLAT-32B, REQ-PLAT-32C, REQ-PLAT-32D):
  An X proof whose bearer, id, or handle commitment public input differs
  from the commitment in the submitted attestation is rejected; a proof
  whose nodes are another identity's, or swapped, is rejected; a proof
  carrying a client identifier, timestamp, or endpoint public input is
  rejected; and a GitHub proof submitted to the X Platform Verifier is
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
  No local identity field originates outside proof public inputs, the
  signed ID Token whose claims a Google proof reads, and the attestation
  bytes, revealed or committed, of its Submission. Only the Consumer's
  acceptance of that exact Submission makes the claim authoritative.
- TEST-PLAT-17A (exercises REQ-PLAT-03, REQ-PLAT-31A):
  Pair authenticated X or GitHub identity-response bytes for account B with a
  detached `userId`, handle, or metadata value for account A offered as an
  extraction input. Prover rejects that alternative source; without it, the
  Prover derives account B byte for byte from the committed ranges, and the
  proof's nodes are account B's; a proof whose id or handle node differs
  from the node of the `userId` or of the handle the Prover would deliver,
  folded, is not delivered. Prover may
  deliver its derived identity separately through CCDP, and Application accepts
  its valid structure without repeating evidence extraction. The delivered
  `userName` preserves the raw handle even when display folding would
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
  live local ceremony or a ceremony already consumed. A decoded `code` of 1024
  visible-ASCII bytes passes; one of 1025 bytes, or one carrying a space or a
  non-ASCII byte, is rejected as malformed.
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
  artifacts. There is no Bridge response whose fields supply it. On X and
  GitHub, the openings of the id and handle commitments, value and blinder,
  are likewise absent from Submissions, logs, and published artifacts.
- TEST-PLAT-22 (exercises REQ-PLAT-31, REQ-PLAT-51, REQ-PLAT-57, REQ-PLAT-58, REQ-PLAT-59, REQ-PLAT-60):
  An X token attestation and a GitHub token-exchange attestation whose
  committed bearer range is not framed by the revealed `"access_token":"`
  delimiter and closing quote are each rejected, including one committing a
  `refresh_token` value instead. An X `/2/users/me` or GitHub `/user`
  attestation is rejected when no commitment is framed by the `id`,
  `username`, or `login` anchors, when two are, when an anchor is revealed
  twice, or when a GitHub `id` commitment is followed by a byte other than
  `,` or `}`; an anchor revealed with JSON whitespace around its colon still
  frames its commitment; and an attestation revealing the id or handle value
  carries no framed commitment for it and is rejected.
- TEST-PLAT-23 (exercises REQ-PLAT-64, REQ-PLAT-65, REQ-PLAT-66, REQ-PLAT-67, REQ-PLAT-68, REQ-PLAT-69):
  The §4.1 vector encodes and decodes exactly, digest included. A notary
  authenticating `API.X.com` or `api.x.com.` writes the `authorityId` of
  `api.x.com`, and adjacent revealed spans reach the record as one range.
  A record with a byte appended or removed, an empty range, ranges out of
  order or overlapping, a range past its signed length, or a commitment
  overlapping a revealed range is rejected. A commitment computed with the
  blinder first, with another blinder width, or under BLAKE3 fails to open
  in the Proving Circuit. A signature over the bare digest, a 64-byte
  signature, the high-`s` twin of a valid signature, a `v` other than 27 or
  28, and a valid signature by an untrusted key are each rejected.
- TEST-PLAT-24 (exercises REQ-PLAT-23, REQ-PLAT-71, REQ-PLAT-72):
  A reading dated more than 300 seconds ahead of Block Time, more than 3600
  seconds behind it, or no later than the current generation is rejected. A
  newer reading of the same set restarts the current generation and keeps
  the previous one. A newer reading of a different set makes the current
  generation previous and drops the older one. A modulus that either
  generation lists is trusted until 2592000 seconds after the creation time
  of the later generation listing it, and a Google proof under it is
  rejected from that moment on. A Google proof under a modulus neither
  generation lists is rejected. The second reading that changes the set
  after the latest reading listing a modulus ends its trust, even with fewer
  than 2592000 seconds elapsed.
- TEST-PLAT-25 (exercises REQ-PLAT-73):
  No Google Key List operation other than an admitted reading or an upgrade
  adds, removes, or re-dates a modulus. A caller other than the Verifier
  Governance Process cannot upgrade the Google Key List, change which Google
  Key List a Platform Verifier reads, or change which Notary Service that
  Google Key List pins. A Platform Verifier switched to a
  new Google Key List trusts no modulus until a reading lands there.

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

This document enforces SP-BIND-01, SP-CLIENT-01, SP-DELIVERY-01,
SP-EXCHANGE-01, SP-FRESH-01, SP-REPLAY-01, and SP-PRIV-01 for the launch
platforms, under the assumptions of
[common §3](ceremony-common.md#3-assumptions).

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
The Application names the bind call's service fee amount and receiver. No
proof bounds them; the Transaction Author's review of the call is the only
check.
Proxy notarization exposes session traffic to the notary; the protocol does
not promise bearer confidentiality from that notary. The bearer remains
hidden from the published proof by the two commitments and link circuit,
and the id and handle by their own commitments and the nodes the circuit
outputs in their place.

The notary key is a trust root for X and GitHub evidence and for Google's
signing moduli, which enter the Google Key List only through readings it
authenticates (§3.4). Its compromise mints fresh X and GitHub evidence until
the key is removed. It can also admit a forged Google modulus, trusted for up
to 30 days after its forged reading unless governance selects another Google
Key List or upgrades this one. Neither undoes authority already committed.

Google has no server-side token exchange. Its fragment is not visible at
HTTP ingress, although the deployment controls Callback code. Its signed
ID Token reaches the redirect fragment and is cleared
before other work. The browser checks `state`, the configured audience, and
canonical nonce encoding and checks the delivered public-input projection;
the circuit binds the signed nonce and claims, and ledger verification binds
that proof to the recomputed authorization digest
and to a signing key the Google Key List trusts from a notarized reading. A
deployment backend can withhold the static redirect
document but cannot substitute an ID Token through a server exchange that
does not exist.

Google's JWKS rotation makes the trusted modulus set a liveness dependency
(REQ-PLAT-72): ledger verification rejects proofs while Google signs with an
untrusted modulus, even if browser proof generation completes. Each reading
pays one Notary Fee, so an unpayable fee, or no reading for 30 days, stops
every Google ceremony.

A binding on any platform publishes its id node and handle node, never the
id, the handle, or Google's `sub`; the handle reaches the chain only when a
transaction discloses it (§2.1b). Common §12 states what that does and does
not hide. On Google the nodes keep the `sub` and the email from readers of
the Consumer Chain, not from a party that already holds them: every
application a user signs in to with Google knows that user's `sub` and can
recompute the id node, and Google's `sub` values are 21-digit decimal
strings in practice, too few to resist a well-resourced search. An email
address is a guessable handle like any other.

The check and fold of §2.1a run inside the Proving Circuits, so they are
part of each profile's proof statement. A Consumer holds only nodes for an
undisclosed binding and cannot re-key it, so changing the check, the fold, a
buffer, or a platform's tags takes a new Platform Ceremony Version and new
circuits.

A stored name is not evidence. The Consumer clears a name whenever its
author stops holding the handle (REQ-PLAT-08J), and emits an event for each
clearing (REQ-PLAT-08F), so a reader that mirrors names from events shows
what the Consumer answers. An event that stores a name replaces the
author's earlier name on any platform; no clearing event precedes it.

## 10. References

Normative: [RFC6749], [RFC7636], [RFC7515], [RFC7517], [RFC7518], [RFC7519],
[RFC8017], [OIDC], [RFC8446], [RFC9207], [EIP-191].

Informative: [RFC9700], [TLSNotary-Proxy], [GitHub-public-clients].

[EIP-191]: https://eips.ethereum.org/EIPS/eip-191

[GitHub-public-clients]: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets

[RFC9207]: https://www.rfc-editor.org/rfc/rfc9207.html

[OIDC]: https://openid.net/specs/openid-connect-core-1_0.html
