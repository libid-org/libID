# A private mode for Gmail handles

**Status: design proposal, with its specification written.** Nothing here
is built. The design is Google Platform Ceremony Version 2. Version 1 is
released: Ethereum mainnet has accepted google/1 bindings since 2026-10-04
on the libid-circuits v0.6.0 circuit, which publishes the email, and it
stays as it is. This note is the rationale; the normative text is on this branch,
and "Spec changes" below maps it. Where the two differ, the specification
holds. Contract references are to `libid-contracts` `origin/main` at
`0a6c5d3`, whose Consumer is `IdentityRegistry`. The gate counts and
proving times below were measured at nargo 1.0.0-beta.25 and bb 5.2.0;
libid-circuits v0.6.0 builds with nargo 1.0.0-rc.3 and bb 6.0.0-rc.2, and
nothing was measured there.

## The thing that must work

Alice binds `alice@gmail.com` to her wallet. Nobody who reads the chain, an
explorer, the indexer or its search learns that address. Bob, whom Alice told
her address, resolves it and pays her. Alice can make the address public
later; she can never make a public one private, because a published log line
is permanent.

One decision is already taken and everything below rests on it: **private
means hidden but resolvable by the exact address.** An unsalted hash of the
normalized email reaches the chain. Whoever knows the address can compute the
hash and resolve it. Whoever does not cannot read it. The design that goes
further, a salted commitment nobody can resolve without a secret the owner
shares, is named at the end under what we deliberately do not do.

## Who learns the email today

A Google version 1 binding publishes the address in four places on chain
and two off it. Its `userId` is already a digest: `SHA256("libid.google-user-id" ||
sub)` (REQ-PLAT-05A), which the verifier returns as `0x` and 64 hex digits
(`GooglePlatformVerifier.sol:251`).

| Where | What carries it | Reader |
|---|---|---|
| `bind` calldata | `email_packed`, two field elements of raw bytes at public-input offsets 36 and 37 of 57 (`OFF_EMAIL`, `PUBLIC_INPUTS`, `GooglePlatformVerifier.sol:54,58`) | anyone with an archive node or an explorer |
| `IdentityBound` log | `string handle`, the normalized email, next to `string id`, the `userId` digest | any log reader, every indexer |
| Contract storage, always | `handlePreimages[handleNode]`, the first handle string bound at that node (`IdentityRegistry.sol:731`) | `identitiesOf`, wallets |
| Contract storage, on request | `published[holder][platformId]`, when `bind` is called with `publish` | `publishedHandleOf`, wallets |
| usernames-indexer | `names.handles.handle TEXT`, with prefix and trigram indexes built for substring search; `/v1/search`, `/v1/resolve/*` | any API client, and the operator's access logs |
| ENS | `alice.google.handles.link` is the address with `@gmail.com` folded into the platform label | any wallet |

The specification on `main` sanctions all of it for the handle: the handle
and the client identifier are published deliberately, and only Google's
`sub` is the exception (`ceremony-common.md` §12). `unpublish` clears only
the storage string and says why: the log line "is already public and always
will be" (`IdentityRegistry.sol:761-779`).

The storage keys are already hashes. `handleNode` is
`keccak256(abi.encode(HANDLE_NODE_V1, platformId, keccak256(normalizedHandle)))`
(`IdentityNodes.sol:39-46`), and every lookup, on chain and in the indexer,
goes through that node. The plaintext exists on chain only to be read back.
That is the whole opening: the system already resolves by hash; it just also
publishes the preimage.

### What hidden-but-resolvable protects, and what it does not

It stops passive collection: nobody scrapes Gmail addresses out of calldata,
logs, an explorer, or a substring search. It does not stop:

- **Confirmation by guessing.** The hash is an unsalted digest of a
  lowercase string with little entropy. Anyone can test a list of addresses
  against every `handleNode` on chain, offline, at hash speed. This is the
  price of resolving by exact address and it cannot be paid down without a
  salt.
- **Confirmation of a known `sub`.** Google's stable account id is one number
  per account, the same at every relying party the person ever signed in to
  with Google, so it is hidden as the `userId` digest and never sent, not
  even with the handle. What remains is the same test as for the address: a
  relying party that holds the `sub` can hash it and confirm the binding.
- **ENS forward names.** `alice.google.handles.link` resolves for a private
  binding as for a public one, by decision: the name is the address, and a
  wallet that resolves it has confirmed it.
- **Access logs.** `GET /v1/resolve/handle/{platform}/{handle}` puts the
  plaintext in the request line of every proxy and log on the way, and the
  route stays, by decision: whoever runs the indexer is trusted with the
  addresses people resolve, and retaining or dropping that path is an
  operational rule, not a protocol one.
- **The fact of a binding.** That this wallet holds some Google identity, and
  when it was observed, stays public.

## Options

Each axis below lists the options with what changes, what it protects, what
it costs, and a verdict. The recommended combination follows.

### What the circuit exposes for the email

**Keep the raw bytes as a public input and stop publishing in the contract.**
Rejected. The email would still sit in the transaction's calldata at offsets
36 and 37 of `publicInputs`, where `GooglePlatformVerifier` reads it
(`GooglePlatformVerifier.sol:254`). A contract that declines to emit what
every explorer can decode from the call protects nothing.

**Replace `email_packed` with a hash of the normalized email.** The circuit
publishes `handle_hash: pub [Field; 2]`, the 32-byte digest packed sixteen
bytes per field, exactly as it already publishes `audience_hash` and
`user_id_hash` (v0.6.0 `oidc-google/src/main.nr:129,132`). The chain then
does for the email what the verifier does for the audience: the payload
carries the plaintext, the digest is recomputed and compared
(`GooglePlatformVerifier.sol:226`, REQ-PLAT-19A), here by the Consumer,
which owns normalization. In private mode the payload carries no plaintext,
and the node is derived from the hash alone. The digest takes the two
offsets the email's bytes hold, so no offset moves and the count stays at
57. A new
verification key and a regenerated `OidcGoogleHonkVerifier.sol` follow
regardless, as they do for any circuit change. **Recommended.**

**Expose both the raw bytes and the hash, with a mode bit.** Rejected. In
private mode the raw slots would have to be zero and the bit would say so,
which is the previous option with two dead field elements, and it is exactly
the "detached second representation of a claim" REQ-PLAT-16B forbids.

**Two circuits, one per mode.** Rejected. Two artifacts, two verifiers, two
normalizers that must agree byte for byte or the same address lands on two
nodes. The plaintext-in-payload option gives the user the same choice with
one artifact. A public-only circuit would still hash the `sub`, so what it
saves is the email's fold and hash: about one second of browser proving
out of seven (see "Measured proving time"). In exchange, a disagreement
between the contract's normalizer and the circuit's would split one address
across two nodes with nothing to notice it, where the one circuit refuses
the public claim because the two digests differ. The user would also have to
choose the mode before proving rather than at submission.

### Where normalization happens

Once only a hash leaves the circuit, the contract can no longer normalize the
bytes itself, so the hash must be over bytes that are already normalized.
Three ways to get there.

**Normalize in the circuit, mirroring the Consumer's rules.** After the
checks the circuit already makes on the email bytes (v0.6.0
`main.nr:159-187`:
prefix match, byte equality with the payload, no interior quote, zero padding
past the length, closing quote, structural byte after it), it folds `A-Z` to
`a-z`, refuses any byte outside the email alphabet `HandleNormalizer._allowed`
admits, refuses a space rather than trimming it (Google never emits one, and
REQ-PLAT-08A forbids trimming), requires exactly one `@` with a nonempty side
on each end as `_hasEmailShape` does (`HandleNormalizer.sol:100-151`), and
hashes exactly `email_len` bytes of the folded buffer, never the 62-byte
padded one, so the digest equals the REQ-PLAT-08M digest the contract
computes from the normalized handle in public mode. This freezes the Google rules of
`handles.json` into the circuit: a rules edit without a circuit release makes
every public claim fail the equality check, which is the enforced form of
REQ-PLAT-08L's invariant that every ceremony version of a platform shares
its normalization. **Recommended.** It amends REQ-PLAT-08A for
the one profile that exposes a digest instead of bytes.

**Hash the raw bytes under a new node tag.** Rejected. `Alice@gmail.com` and
`alice@gmail.com` become two identities, and a public claim (normalized in
the contract) and a private claim (raw in the circuit) of the same address
land on two nodes. That is the split namespace the invariant exists to
prevent.

**Hash the raw bytes and rely on Google emitting lowercase.** Rejected.
Nothing Google signs promises the case of `email`; one token with an
uppercase letter splits the namespace silently.

### Which hash

The choice decides whether Google's `handleNode` stays what it is, and so
whether a version 1 binding and a version 2 binding of one address meet.
The specification takes keccak256 (REQ-PLAT-08M).

**keccak256 of the normalized bytes.** Taken. The digest is the inner hash
of `handleNode` exactly (`IdentityNodes.sol:39-46`), so the node of a
private version 2 binding, a public one, a version 1 binding and an ENS
lookup is one value. The contract, `handleHashOf` and
`HandleEscrow.deposit`, the indexer's node arithmetic
(`usernames-core/src/nodes.rs`), the TypeScript resolver and the ENS
gateway keep their derivation untouched. The release of version 1 decides
it: mainnet already holds Google bindings under keccak256 nodes, and the
Consumer, holding only a digest for a private binding, cannot map one hash
function onto another without the address. It costs a keccak library in
the circuit, the most gates of the options measured below.

**SHA-256 of the normalized bytes, tagged.** Rejected.
`SHA256(UTF8("libid.google-handle") || email)` reuses the hash the circuit
already computes for the signing input and the `sub`, and measured fewer
gates. But every version 2 node would differ from the version 1 node of
the same address: one address would hold two handle nodes, a version 2
binding would not supersede a version 1 binding of it, and a
`HandleEscrow` deposit made to one node would not reach a holder bound at
the other.

**Poseidon.** Cheapest in a circuit and no precedent anywhere in libID's
Solidity, Rust or TypeScript. It splits the nodes as the tagged SHA-256
does. Not for this design.

Measured on a scratch copy of the circuit at nargo 1.0.0-beta.25 and bb
5.2.0, with the fold-and-shape loop included in both variants (`nargo
compile`, then `bb gates --oracle_hash keccak`):

| Circuit | ACIR opcodes | Honk gates | Delta |
|---|---|---|---|
| baseline | 44,612 | 179,443 | |
| fold + SHA-256 | 49,918 | 192,254 | +7.1% |
| fold + keccak256 (library v0.1.3) | 49,911 | 203,878 | +13.6% |

Proving time for keccak256 builds is measured in "Measured proving time"
below.

### The account id, `sub`

REQ-PLAT-05A already hides the `sub`: the canonical `userId` is
`SHA256(UTF8("libid.google-user-id") || sub)`, which libid-circuits v0.6.0
exposes as `user_id_hash` with a 31-byte `sub` buffer
(`oidc-google/src/main.nr:14,51-60,132`). The verifier returns it as the
`userId` string, `0x` and 64 lowercase hex digits
(`GooglePlatformVerifier.sol:251`); `idNode` is the keccak256 node of that
string (`IdentityNodes.sol:31-33`), and `IdentityBound` carries it as
`id`, in both versions. This design changes none of that, and a
Submission never carries the `sub` itself, so a version 1 and a version 2
binding of one account share their identity node.

A verifier that receives a digest can inspect nothing, so the circuit owns
the whole of the id's validation, which REQ-PLAT-04 and, for version 2,
REQ-PLAT-04A state for every implementation: `sub_len` at least 1; every byte within `sub_len` in `0x20`
through `0x7e`, so no control byte, no non-ASCII byte and no quote; no
backslash, because every JSON escape begins with one and an escaped `sub`
would digest its escaped form; the padding zero; and the digest over
exactly `sub_len` bytes. v0.6.0 refuses a quote but not a backslash
(`main.nr:78-79`), so the version 2 release adds that refusal.
`SUB_MAX` is 31, version 2's bound in REQ-PLAT-04A, a Google `sub` being
21 digits, and a `sub` longer than it fails to prove rather than
truncating. That Google issues no longer `sub` is part of ASM-PROV-05, a
liveness dependency: an account outside it could not be bound, and none
would be misbound. Raising the bound costs a second SHA-256 block, since
the tag and 31 bytes fill one.

Measured the same way as above, with keccak256 for both digests, against
the baseline of "Measured proving time":

| Circuit | ACIR opcodes | Honk gates | Delta |
|---|---|---|---|
| fold + keccak256 of the email, keccak256 of `sub` | 50,375 | 223,582 | +24.6% |

The specification digests the `sub` with SHA-256 (REQ-PLAT-05A) and the
email with keccak256; that build has not been measured.

### Measured proving time

Three builds of the circuit, each proving a valid witness: an RSA-2048 key
generated for the run signs a Google-shaped ID token, since the circuit
takes the modulus as a public input. **Baseline** is `oidc-google` at
`e59b804`, which exposes the `sub` and the email as bytes.
**Public-only** is the baseline with a `sub` digest and
the email still published as bytes, which is what a second, public circuit
would be. **One circuit** adds the email's fold, shape checks and keccak256
to it, which is this design. Every proof verified. The digest the one
circuit exposes equals `cast keccak` of the lowercased email, an
independent check of the fold.

| Circuit | ACIR opcodes | Honk gates | Public inputs |
|---|---|---|---|
| baseline | 44,612 | 179,443 | 56 |
| public-only | 45,567 | 200,011 | 57 |
| one circuit | 50,518 | 223,663 | 57 |

The one-circuit build here counts 81 gates more than the table in the
previous section; the two builds were written separately, and the
difference does not move any figure below. All three sit under 2^18 gates, the SRS size
the ceremony's proof worker loads, with 38,481 to spare in the largest.

Median proving time, in seconds, witness generation excluded:

| Circuit | bb.js WASM, 1 thread | 4 threads | 8 threads | native `bb` |
|---|---|---|---|---|
| baseline | 14.13 | 5.64 | 5.81 | 1.69 |
| public-only | 16.12 | 6.26 | 6.91 | 1.90 |
| one circuit | 17.70 | 7.27 | 7.84 | 2.15 |

Four threads is what the proof worker uses on a machine with four or more.
There, one circuit proves in 7.3 s, 1.6 s more than the baseline, and a
public-only circuit would save 1.0 s of it on a public claim, about 14%.
Witness generation (`noir_js` execute) takes 0.4 s for each. Peak memory
of the native prover is 293, 324 and 369 MB. Eight threads is no faster
than four on this four-core machine.

All three builds use keccak256 for both digests. Method: bb.js 5.2.0 and
`noir_js` 1.0.0-beta.25 in Node 22 with the proof
worker's settings (`BackendType.Wasm`, `srsSize` 2^18, keccak oracle, ZK,
a verification key supplied, as the worker supplies the released one), one fresh backend per proof,
three proofs per cell and seven at four threads; native `bb prove -t evm`
at bb 5.2.0, six runs. Machine: Intel Core i7-1165G7 (4 cores, 8
threads), 15 GB RAM, Ubuntu 24.04. A browser runs the same WASM, but its
worker overhead and thread scheduling were not measured, so these are the
proving cost itself rather than a user's wait.

### Where the mode lives

**The presence of the handle in the payload.** `GoogleProof` gains one
optional field, `bytes email`, beside `clientIdentifier`
(`GooglePlatformVerifier.sol:84-92`); empty means private. It never gains
a `sub` field: the `sub` is never sent, since nothing on chain or in the
indexer reads it as text (`resolveId` and `resolveHandleAndId` hash the
`userId` string the caller supplies), and it is the one value that also
names the account at every other relying party. The verifier keeps
returning the `userId` digest as the hex `userId` string, passes the email
bytes through, marked unverified, and returns the handle digest the proof
bound as a new `VerifiedClaim.handleHash`; it checks nothing about the
bytes, because the check needs the handle normalized and normalization is
the Consumer's (REQ-PLAT-08B). `IdentityRegistry._write` is the one place
the equality holds: it derives the handle node from the digest in both
modes; when the email is present it normalizes it, requires its
REQ-PLAT-08M digest, `keccak256(normalized)`, to
equal `handleHash`, and only then stores or emits the handle, normalized.
`bind(..., publish: true)` without the email reverts. X and GitHub
verifiers, and the version 1 Google verifier, return no handle digest and
keep the plaintext path they have.
**Recommended:** one optional payload field, no change to the signature of
`bind` or to any binding's Authorized Transaction Data. It
keeps REQ-PLAT-08B honest in the form that matters: the Consumer still
derives the key from a proof-bound value and still refuses a
caller-supplied key; the email is accepted only because the proof binds
its digest.

Whoever assembles the transaction decides whether it carries the email,
and that is the application. The ID Token lands in the OAuth Bridge's
Callback and reaches the CCDP Prover on the Distribution origin; the
Prover delivers the proof, the raw email as `userName` and the `userId`
digest to the Application, never the token or the `sub`. The Application
operator therefore holds the email, and the Bridge and Distribution
operators can read the whole token, whatever any field says. The privacy
this design buys is against readers of the chain: SP-PRIV-01 bounds what
the chain yields, and a transaction any of those operators sends with the
email is one it permits (§4 of `ceremony-common.md`). The rule that a
Submission carries the email only when the user asks binds the
Application, which builds the Submission (REQ-PLAT-03A); the Prover must
prove in the zero-knowledge mode with fresh randomness (REQ-COMMON-45A).

**The choice in the binding's Authorized Transaction Data.** Rejected. It
would commit a `disclose` flag in the Authorization Digest like the fee,
but no trusted screen shows it to the user, the Canonical Runtime cannot
decode Authorized Transaction Data to honour it, and the token has
already reached the application; a field that enforces nothing only
changes every X and GitHub binding's encoding.

**A `disclose` flag on `bind`.** Rejected. Two sources of truth for one
fact, the email's presence, and nothing to do when they disagree.

**A mode bit as a circuit public input.** Rejected. It bakes the disclosure
choice into the proof, costs an input, and stops the user from changing
their mind between proving and submitting.

`IdentityBound` gains `bool disclosed` and keeps `string handle`, empty
when private, and `string id`, which for Google is the `userId` digest in
hex and is carried in every event. `disclosed`
is a fact about the event: this event carries the handle. It says nothing
about earlier events, and it cannot, because a handle once emitted is
public for good. An empty string is unambiguous, since the normalizer
rejects an empty handle, but the bool is what an indexer reads without
parsing. A separate indexed `handleHash` would duplicate `handleNode`.
The event's `published` says whether this binding wrote the wallet's
name, which a private binding never does; `publish` emits
`IdentityPublished` and `unpublish` emits `HandleUnpublished`, so an
indexer can mirror the stored name from the log. `_list` writes no
`handlePreimages` entry for an undisclosed handle, so `identitiesOf`
returns no handle string for it; a later disclosure fills it.

### Default, and moving between modes

**Google version 2 is private unless the application sends the email.** That is the premise
of this note. Public by default with a private opt-in would leave §12's
rationale intact and is recorded here only as the alternative not taken.

**X and GitHub stay as they are.** Their handles are public on the platform
by construction, their circuits reveal transcript bytes the notary attested,
and §12's reasoning holds for them. The zero `handleHash` leaves the door
open. The name rules below are every platform's, since the slot is shared:
on X and GitHub too, a binding of a wallet's second account stops
replacing the first account's name, which `_write` does today when any
publication exists (`IdentityRegistry.sol:697`).

**Private to public, later.** By decision a call, not a new binding, and the
contract already has its inverse, `unpublish`, so the call is
`publish(platformId, string handle)`: normalize the handle, derive its
node, require that the caller holds it (below), set `published`, emit
`IdentityPublished(owner, platformId, idNode, handleNode, handle)`. No
proof is needed and no `sub`: the handle's preimage is the proof, and the
identity follows from the handle's node. The address is public from the block the call is sent in, whether
or not it is accepted: a refused `publish` still leaves its calldata on
chain.

A wallet **holds** a handle while it owns the handle's node, and that one
test decides both `publish` and what reads as a name. Ownership means
holding because of retirement: when an account binds again under another
handle, the old node's holder is cleared, its watermark kept, and
`HandleRetired` emitted (`IdentityRegistry.sol:752-759`), unless another account has proved that
handle in the meantime, in which case the node is that account's. So a
retired handle has no owner, and `publish` refuses it however well the
caller knows its preimage. A handle one of the wallet's accounts took from
another of them is owned by the wallet, and `publish` accepts it: the
wallet holds it through the second account. The two-way pairing check
(`idNodeByHandle[handleNode]` naming an `idNode` whose `handleNodeById`
is that node, and the wallet owning both) gives the same answer in every state the
contract can reach, because `_write` sets both owners and both pairings
together and retirement clears the only owner a moved pairing leaves
behind; the owner check is the simpler statement of it, and it is exactly
the test `publishedHandleOf` already makes (`:916-924`).

**The name, per platform, like an ENS primary name.** A wallet may hold
several accounts of one platform. It has one name there,
`published[wallet][platformId]`, the handle it chose to show, and the
stored string counts only while the wallet holds it: `publishedHandleOf` answers
the stored handle, re-normalized under the current rules, only while its
node's owner is the wallet, and answers nothing otherwise. That is ENS's
rule for primary names, forward-resolve before trusting the reverse
record, made by the contract so no reader can skip it. Nothing therefore
has to clear a name when its handle moves: a rename that retires the
handle, another account proving it, or a rules change each make
`publishedHandleOf` go empty on their own, and an indexer mirroring
`names.published` applies the same test. The slot is written only by

- a binding that carries the handle and asks to publish it;
- a binding that carries the handle for the account whose handle is the
  current name (`idNodeByHandle[node(name)] == idNode`), so a rename of the
  named account refreshes the name rather than leaving the old string;
- `publish`, and cleared only by `unpublish`.

Both binding paths apply only when the binding is written, that is, when
its evidence is newer than both nodes' watermarks. A binding for another
account of the same wallet never touches the slot, and a private binding
carries no handle to store and never touches it either.
After a private rename the old string stays stored and reads as no name,
since the retired node has no owner; the wallet publishes the new handle
when it chooses, which is the disclosure step.

Two facts therefore live apart. **Disclosure** is history: once an
accepted binding or `publish` has carried a handle, the handle is known
and stays known, whatever private binding or `unpublish` follows. A refused
transaction discloses nothing on record, but its calldata is public all
the same; no event marks it. **Publication** is state: whether
`publishedHandleOf` answers the handle now. The sequence private binding,
`publish`, private
refresh of the same handle ends with the handle known, the name
published, and the last event saying `disclosed: false`, all three true at
once.

**Public to private.** Impossible, and the note should say so where users
read it. That includes every account bound under version 1: a version 2
binding of it lands on the same nodes and supersedes the version 1 binding,
but the version 1 event already carried the address. The log line exists. `unpublish` already documents this for the
storage string; the same sentence covers the event.

### Downstream

**usernames-indexer.** `names.handles.handle` becomes nullable;
`names.ids.user_id` keeps the `userId` string the event carries, the hex
digest for Google; `names.published`
stays plaintext, since only a disclosed handle can be published. `resolve_handle` currently selects `WHERE h.handle = $3`
(`handle_lookup`, `usernames-core/src/db.rs:1186-1199`) and moves to the node: fold the query,
normalize, derive `handleNode` with the function the indexer already has
(`nodes.rs`), select by node. `/v1/search` excludes private bindings by
construction, since there is no text to match. The recompute check that
compares a re-derived node with the emitted topic (`db.rs:791-798`) skips the
handle when the event carries none; `/v1/resolve/id` keeps selecting by
the `userId` string, which a caller holding a `sub` computes. The indexer keeps the two facts apart as the
contract does: `IdentityPublished` fills a `names.handles` row whose
plaintext was null and sets `names.published`; a later private event never
nulls a plaintext row. `names.published` mirrors the stored slot from the
events, which say whether a binding wrote it, and a response reports it as
published only while the wallet owns the handle's node, the test
`publishedHandleOf` makes. Responses carry `disclosed`, meaning an accepted event carried this
handle, and `published`, the current state; an undisclosed identity
returns `handle: null` beside its `userId`. `disclosed:
false` does not promise the handle never reached the chain: a refused
transaction's calldata is not an event. The resolve routes keep the plaintext in the path,
by decision; a `GET /v1/resolve/node/{platform}/{handleNode}` where the
client hashes, so the server never sees the address, can be added later for
clients that want it, as the ENS gateway already works.

**ENS gateway.** The node is the same in both modes, so a private binding
can resolve as `alice.google.handles.link`, and that is the decided
behaviour. It does not follow without work: the gateway reads the indexer's
store, not the chain (`bin/usernames-api/src/ens.rs:409-420` calls the
store's `resolve_handle`), and that lookup selects by the handle string
(`db.rs:1186-1199`), which a private binding does not have. The gateway
resolves private bindings once `resolve_handle` selects by node, the same
change the resolve route needs above, and not before; the rollout ships
the two together.

**TypeScript claim SDK.** The Google proof type carries `email` as a required
string; it becomes optional, absent for private, and the proof type carries
no `sub` at all. Client-side normalization
must produce the bytes the circuit hashes, and `handle.ts` already
reproduces the shared vector table, so the only new obligation is that the
circuit input builder feeds the circuit the raw bytes and expects the digest
of the folded ones. The local result keeps returning the raw signed email
as `userName` and the `userId` digest to the application, which holds the
token anyway; the prover must run in the zero-knowledge mode with fresh
randomness (REQ-COMMON-45A), which today depends on `prove.worker.ts` setting
`verifierTarget: 'evm'` and is written down as a requirement instead.

**Demo.** The "publish the handle on chain" checkbox becomes a three-way
choice, made at submission: private, public, public and published.

### Spec changes

Written, on this branch. The map, for a reader coming from the specs:

- `platform-ceremonies.md`: §2.1a's lead-in and REQ-PLAT-08A/08B admit a
  circuit that normalizes what it digests, refusing where the table trims,
  and a Consumer that keys on digests and normalizes every handle it
  receives. §2.1b defines, for every platform, the identity key and handle
  key and what holding a handle means (REQ-PLAT-08H, 08I: keys from the
  inner digests only, a write only for evidence newer than both keys'
  watermarks, and retirement that keeps the watermark), and the
  per-platform name (REQ-PLAT-08J, 08K: written only by a binding the
  Consumer writes, which carries the handle and asks to publish or renames
  the named account, a path skipped when the stored name no longer
  normalizes, by the disclosure call, or cleared by withdrawal; read only
  while the wallet holds it), with TEST-PLAT-20B. It defines what
  "carries" means on every platform (an X or GitHub binding always carries
  its revealed handle, a digest-profile one when its field is nonempty)
  and places the publish request in the Consumer's call, outside the
  Submission Payload and the Authorized Transaction Data, as `bind`'s
  `publish` argument is. REQ-PLAT-08M fixes the handle digest as
  keccak256 of the normalized handle on every platform and version, so a
  version 1 and a version 2 Google binding of one address share a handle
  key. For a digest profile it defines the profile, the Consumer's
  configured record of whether a platform admits digests, with every
  version sharing the platform's normalization and verified handle bytes
  told apart from the unverified carried handle (08L), that its account
  identifier, the
  `sub`, is never sent, disclosure (history) and publication (state), and
  holds REQ-PLAT-08D (keys from the digests, a handle accepted
  only when it hashes to its digest), 08E (the disclosure call on the handle
  alone, accepted only when the caller holds it, and what a refusal does
  not protect), 08F (the event's flags, the normalized handle where one was
  carried, never the `sub`), 08G (the published handle table, fixed once
  a platform admits digests and has bound anything; admission that can
  start after bindings exist and cannot be withdrawn once used) and
  TEST-PLAT-20A. §7 requires a new profile to say whether it is a digest
  profile.
  REQ-PLAT-03 and TEST-PLAT-17 name the ID Token as a digest profile's
  local source, with the delivered handle raw; REQ-PLAT-03A gives the
  disclosure choice to the Application, which builds the Submission, since
  the CCDP Prover builds none. §3 keeps Google version 1 as main states it
  and adds version 2, whose §3.4 states only what it changes: REQ-PLAT-04A
  bounds its `sub` at 31 bytes and refuses a backslash, both checked on
  the signed bytes; REQ-PLAT-16E replaces the raw `email` public input
  with the handle digest; 16F moves the `sub` and `email` validation and
  the normalization into the circuit and states the 31- and 62-byte
  buffers; 16D has the verifier return the digests, pass the email through
  unchecked, store and emit no email, and carry no `sub`; §3.4 also says
  version 1's artifacts are the v0.6.0 circuit and version 2 awaits a
  release. TEST-PLAT-06A exercises them; §9 states what version 2 protects,
  what it does not, and that it hides nothing a version 1 transaction
  already published.
- `ceremony-common.md`: the digest profile as a term; ASM-PROV-05 gains the
  version 2 `sub` shape as a liveness clause; ASM-HASH-01, ASM-ZK-01 (the
  zero-knowledge proving mode), SP-PRIV-01 (the Consumer, the Proof
  Verifier and the Platform Verifier emit or store only what a transaction
  carried, and no account identifier), with §4 stating that it bounds the
  chain's artifacts, not who learns the handle (the Application and the
  CCDP Distribution both can), and rests on an unmodified Prover;
  REQ-COMMON-05E returns the digests, and
  the handle marked unverified, where a profile exposes digests;
  REQ-COMMON-45 and 45A have governance select zero-knowledge artifacts and
  the Canonical Runtime (its Prover) prove in that mode with fresh
  randomness from a cryptographically secure source, which TEST-COMMON-22A
  checks; REQ-COMMON-19E treats a digest profile's
  plaintext handle as a comparison, not an extraction, and lets the
  Canonical Runtime read the signed token the Submission's proof digests;
  the account identifier is the term for the value a `userId` is derived
  from, Google's `sub`;
  §12 replaces "published deliberately" for the handle and user identifier
  with what a digest profile keeps off the chain and its limits, including
  an account already bound under version 1.
- `libid.md`: sentences among the enforceable guarantees, including what
  each Google version's circuit proves; the Application and CCDP
  Distribution rows in the trust table: the Application decides whether a
  Google handle is sent, and the Distribution's Prover holds the ID Token
  and must prove in the zero-knowledge mode; and `("google", 2)` in the
  protocol-parameter table.
- `ccdp.md`: normalization is the Consumer's and, for a digest profile,
  also the Proving Circuit's.

## The recommendation

A new Google Platform Ceremony Version 2; hash in the circuit, normalize in
the circuit, keccak256 over the email so that version 1 and version 2
bindings share a node, main's tagged SHA-256 over the `sub`, the mode set by the presence of the email in the payload and
the `sub` never sent, private by default for Google alone, `publish` to go public later, ENS forward names
resolving for private bindings as for public ones, and the resolve routes as
they are. This is the one combination where neither the email nor the
account id reaches calldata, where both nodes are identical across modes
and readers, where the verifier reuses a pattern it already has for
the audience, and where the payload change is one optional field.

It does not protect against confirmation of a suspected address or account
id by whoever already holds it, the query plaintext in the indexer's access
logs, the visibility of the binding itself, or an application operator,
which receives the email, or a Bridge or Distribution operator, which can
read the ID Token, sending the address itself.

## What to implement, in order

1. **Spec** (`libid`): the amendments above, and a note on the vector table
   that the trim rows do not apply to the circuit, which refuses a space
   instead. Done when a reader can follow the new property to its
   requirements and its test.
2. **Circuit** (`libid-circuits`): a version 2 `oidc-google` circuit beside
   the version 1 one: the fold-and-shape loop, the keccak library,
   `handle_hash`, the keccak256 of the normalized email, in place of
   `email_packed`,
   the backslash refusal beside the quote refusal on the `sub` that
   `user_id_hash` digests, a gate count in the commit, and a release whose
   artifacts the ceremony can pin. Done when `Alice@Gmail.com`
   and `alice@gmail.com` prove the same digest, equal to `cast keccak` of
   `alice@gmail.com`, and a space, two `@`, an
   empty local part and a garbage tail each fail to prove, as does a `sub`
   holding a backslash.
3. **Contracts** (`libid-contracts`): a version 2 Google Platform Verifier
   registered under its own Verifier Version beside version 1's, `bytes
   email` in its payload, `handleHash` in `VerifiedClaim` beside the
   `userId` digest string it already carries, the equality check and the
   hash-derived handle node in `_write`; `_write` storing the name only
   for a binding carrying the handle that asks to publish or whose
   account's handle is the current name
   (`idNodeByHandle[node(name)] == idNode`), and only when it writes the
   binding, never for a private binding, a binding of another account, or
   evidence not newer than both nodes; no `handlePreimages` entry for an
   undisclosed handle; `disclosed` in the event;
   `publish(platformId, handle)` accepted only when the caller owns the
   handle's node; a per-platform flag beside the rules in `setPlatform`
   saying whether the platform admits digest results, checked against
   every verifier result, settable after version 1 bindings exist and not
   clearable once a digest result was accepted; `setPlatform` refusing a
   Google rules change once the flag is set and Google has bound anything;
   the circuit pin. Done when the same account bound under version 1, and
   under version 2 public and then private, lands on the same two nodes; when a private transaction, made with recognizable test values,
   carries no plaintext email or account id in its decoded calldata or its
   decoded events, the payload's email field and the event's handle string
   being empty, rather than a byte search over proof bytes that can contain
   anything; when no transaction, private or not, carries the `sub`; and
   when `bind(..., publish: true)` without the email, and a `publish` of a
   handle the caller does not own, both revert; when a wallet holding two
   accounts of one platform keeps the first account's name through any
   binding of the second.
4. **Indexer, SDK, demo**: nullable handle, node-keyed handle resolve,
   the ENS gateway on the node-keyed lookup, `IdentityPublished`
   filling the handle row and the publication state, optional `email` and
   no `sub`, the three-way choice. Done when resolve and the gateway find a
   private binding by exact address or account id, search never returns
   it, `publishedHandleOf` is empty and `identitiesOf` returns no handle
   for it, and the sequence private binding,
   `publish`, private refresh of the same handle reads back as known,
   published, last event undisclosed. The node-keyed lookups are proven against the
   chain, not against a hand-computed hash: one test binds on a local
   chain and checks the nodes the indexer recomputes against the
   `IdentityBound` event the contract emitted, the check `db.rs:791-798`
   already makes on every event.

## What we deliberately do not do

- **A salted commitment.** `verify_hash_commit` in the bearer-link circuit
  already proves `SHA256(plaintext || blinder)` (`bearer-link/src/main.nr:51-70`)
  and would apply to an email unchanged. It defeats guessing, and it defeats
  resolving: nobody can find Alice without her blinder. That is a different
  product, a stealth address, and it can be added later as a third mode with
  its own node tag without disturbing this one.
- **Changing X and GitHub.** Their handles are public where they live.
- **Per-chain variants.** The node is chain-independent today and stays so.
- **Hiding the address from the application.** Out of reach while the
  Application receives the email in the ceremony result and the Google
  client belongs to its deployment, whose owner can ask Google for the
  email directly. `neutral-google-client.md`
  checks whether one libID-operated client, with a confirmation screen the
  runtime owns, could close that gap, and what it would cost.

## Open decisions

Decided: `alice.google.handles.link` resolves for a private binding, so the
name is the address and a wallet that resolves it has confirmed it, and with
it that confirming a suspected address by hashing it is accepted; `sub` is
hidden with the handle and never sent, not even when the handle is;
private to public is a `publish` call on the handle alone, not a new
binding; the resolve routes keep the plaintext in the
request line, the indexer's operator being trusted with what people resolve;
`publish` accepts a handle only while the wallet holds it, so it refuses
one retired by a later binding of the same account, as set out under
"Default, and moving between modes"; a wallet may hold several accounts of
one platform and has one name there, which no binding of another account
and no private binding writes, and which reads as a name only while the
wallet holds it; the application chooses whether a binding carries the
email, and the privacy is against readers of the chain, not against an
operator that handles the email; the design is Google version 2, version
1 being released; the email is hidden as keccak256 of the normalized
address, so version 1 and version 2 bindings share a handle node, and the
`sub` as main's tagged SHA-256; Google's handle rules are fixed once a
Consumer admits version 2 and Google has bound anything; and the proof is
made in the
zero-knowledge mode with fresh randomness, which the privacy rests on as
much as on the hash.

One thing is open: no published libid-circuits release proves Google
version 2. v0.6.0, version 1's circuit, exposes the email bytes as
`email_packed`, normalizes nothing, and admits a backslash in the `sub`
(`oidc-google/src/main.nr:78-79,133`), so version 2 is implementable only
once a release that enforces REQ-PLAT-16E and REQ-PLAT-16F publishes its
artifacts (platform §3.4).

The indexer and the deployer derive nodes and platform ids from the same
generated table the contract's constants come from (`libid-identity`
0.13, `usernames-indexer` `Cargo.toml:20-22`, `libid-deploy`
`platforms.rs:174-206`), and the indexer's pinned vectors reproduce the
contract's derivation (`nodes.rs:302-320`). Nothing needs aligning before
the node-keyed lookups; the test above keeps it that way.

## Sources

Spec references are to this branch. `libid-contracts` lines are against
`origin/main` at `0a6c5d3` (2026-10-05); the indexer, deployer and the
measured circuit builds are against the revisions named below, as of
2026-09-22.

- `libid-contracts/solidity/contracts/ceremony/GooglePlatformVerifier.sol`:
  offsets and input count (51-58), `GoogleProof` (84-92), audience check
  (226), `userId` (251), handle (254); `ceremony/ICeremony.sol:75-84`
  (`VerifiedClaim`); `identity/IdentityRegistry.sol`: `IdentityBound`
  (326-336), `_write` (643-705), `_list` (715-732), `_retirePreviousHandle`
  (752-759), `unpublish` (761-779), `handleHashOf` (835-841),
  `publishedHandleOf` (916-924); `identity/IdentityNodes.sol` (25-46);
  `identity/HandleNormalizer.sol`; `identity/handles.json`;
  `escrow/HandleEscrow.sol` (`deposit`, 169-178), which needs no change.
- `libid-circuits` `circuits/bearer-link/src/main.nr:51-70`
  (`verify_hash_commit`).
- `usernames-indexer` at `origin/main` `bec6765`, `crates/usernames-core`:
  `migrations/001_schema.sql` (47, 73, 83-91), `src/db.rs` (791-798,
  1091-1100, 1133, 1186-1199), `src/api/mod.rs` (79-84), `src/ens.rs`
  (500-542), `src/nodes.rs` (241-243, 302-320); `bin/usernames-api/src/ens.rs`
  (416). `chain-configurations` at `origin/main` `f15832a`:
  `bin/libid-deploy/src/platforms.rs` (174-206).
- `libid-circuits` `v0.6.0`, `circuits/oidc-google/src/main.nr`:
  `SUB_MAX` (14), `user_id_digest` (51-60), the `sub` byte check (78-79),
  public inputs (127-135).
- Gate counts: `nargo info` and `bb gates` on scratch copies of the circuit
  at nargo 1.0.0-beta.25 and bb 5.2.0, with `noir-lang/keccak256` v0.1.3.
- Proving times: `libid-circuits` `origin/main` `e59b804`, the three builds
  and the harness described under "Measured proving time"; the worker's
  settings are those of libID PR #28's `engine.worker.ts`.
