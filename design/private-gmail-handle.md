# A private mode for Gmail handles

**Status: design proposal, with its specification written.** Nothing here
is built. This note is the rationale; the normative text is on this branch,
and "Spec changes" below maps it.

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

A Google binding publishes the address in three places on chain and two off
it.

| Where | What carries it | Reader |
|---|---|---|
| Claim calldata | `email_packed`, two field elements of raw bytes at public-input slots 35 and 36 | anyone with an archive node or an explorer |
| `IdentityBound` log | `string handle`, the normalized email, next to `string userId` | any log reader, every indexer |
| Contract storage | `published[owner][platformId]`, the plaintext, when the user asked to publish | `reverseOf`, `primaryOf`, wallets |
| usernames-indexer | `names.handles.handle TEXT`, with prefix and trigram indexes built for substring search; `/v1/search`, `/v1/resolve/*` | any API client, and the operator's access logs |
| ENS | `alice.google.handles.link` is the address with `@gmail.com` folded into the platform label | any wallet |

The spec sanctions all of it: "the handle, the platform user identifier, and
the client identifier are published deliberately … the protocol treats none
of them as confidential" (`ceremony-common.md` §12). `unpublish` clears only
the storage string and says why: the log line "is already public and always
will be" (`IdentityNames.sol:678-686`).

The storage keys are already hashes. `handleNode` is
`keccak256(abi.encode(HANDLE_NODE_V1, platformId, keccak256(normalizedHandle)))`
(`IdentityNodes.sol:37-41`), and every lookup, on chain and in the indexer,
goes through that node. The plaintext exists on chain only to be read back.
That is the whole opening: the system already resolves by hash; it just also
publishes the preimage.

### What hidden-but-resolvable protects, and what it does not

It stops passive collection: nobody scrapes Gmail addresses out of calldata,
logs, an explorer, or a substring search. It does not stop:

- **Confirmation by guessing.** The hash is an unsalted keccak of a
  lowercase string with little entropy. Anyone can test a list of addresses
  against every `handleNode` on chain, offline, at hash speed. This is the
  price of resolving by exact address and it cannot be paid down without a
  salt.
- **Confirmation of a known `sub`.** Google's stable account id is one number
  per account, the same at every relying party the person ever signed in to
  with Google, so it is hidden with the handle, by decision. What remains is
  the same test as for the address: a relying party that holds the `sub`
  can hash it and confirm the binding.
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
Rejected. The email would still sit in the transaction's calldata at slots
35 and 36 of `publicInputs`, where `GooglePlatformVerifier` reads it today
(`GooglePlatformVerifier.sol:237`). A contract that declines to emit what
every explorer can decode from the call protects nothing.

**Replace `email_packed` with a hash of the normalized email.** The circuit
publishes `handle_hash: pub [Field; 2]`, the 32-byte digest packed sixteen
bytes per field, exactly as it already publishes `audience_hash`
(`oidc-google/src/main.nr:259-267`). The chain then does for the email
what the verifier does for the audience today: the payload carries the
plaintext, the digest is recomputed and compared
(`GooglePlatformVerifier.sol:206-210`, REQ-PLAT-19A), here by the Consumer,
which owns normalization. In private mode the payload carries no plaintext,
and the node is derived from the hash alone. The digest takes the two slots
the email's bytes held, so the email alone moves no offset; the `sub`
digest below adds the one slot that does. A new
verification key and a regenerated `OidcGoogleHonkVerifier.sol` follow
regardless, as they do for any circuit change. **Recommended.**

**Expose both the raw bytes and the hash, with a mode bit.** Rejected. In
private mode the raw slots would have to be zero and the bit would say so,
which is the previous option with two dead field elements, and it is exactly
the "detached second representation of a claim" REQ-PLAT-16B forbids.

**Two circuits, one per mode.** Rejected. Two artifacts, two verifiers, two
normalizers that must agree byte for byte or the same address lands on two
nodes. The plaintext-in-payload option gives the user the same choice with
one artifact.

### Where normalization happens

Once only a hash leaves the circuit, the contract can no longer normalize the
bytes itself, so the hash must be over bytes that are already normalized.
Three ways to get there.

**Normalize in the circuit, mirroring the Consumer's rules.** After the
checks the circuit already makes on the email bytes (`main.nr:125-147`:
prefix match, byte equality with the payload, no interior quote, zero padding
past the length, closing quote, structural byte after it), it folds `A-Z` to
`a-z`, refuses any byte outside the email alphabet `HandleNormalizer._allowed`
admits, refuses a space rather than trimming it (Google never emits one, and
REQ-PLAT-08A forbids trimming), requires exactly one `@` with a nonempty side
on each end as `_hasEmailShape` does (`HandleNormalizer.sol:100-148`), and
hashes exactly `email_len` bytes of the folded buffer, never the 62-byte
padded one, so the digest equals `keccak256(bytes(normalizedHandle))` as the
contract computes it in public mode. This freezes the Google rules of
`handles.json` into the circuit: a rules edit without a circuit release makes
every public claim fail the equality check, which is the enforced form of the
invariant `IdentityNames.sol:106-112` states in prose, that the key a handle
hashes to cannot vary by version. **Recommended.** It amends REQ-PLAT-08A for
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

The choice decides whether Google's `handleNode` stays what it is today.

**keccak256 of the normalized bytes.** The digest is the inner hash of
`handleNode` exactly (`IdentityNodes.sol:39-41`), so the node of a private
claim, a public claim and an ENS lookup is one value.
The contract, the indexer's node arithmetic (`usernames-core/src/nodes.rs`),
the TypeScript resolver and the ENS gateway keep their derivation untouched.
The pinned Noir (`toolchain.env`: nargo 1.0.0-beta.25, bb 5.2.0) has no
keccak in its standard library; the `noir-lang/keccak256` library at v0.1.3
compiles under it (v0.1.1, the version vendored locally today, does not: it
names a `keccakf1600` the pinned standard library no longer has).

**SHA-256 of the normalized bytes.** Already in the circuit's dependencies
and cheaper. But the node's inner hash would then be SHA-256 for Google and
keccak for everything else, so `IdentityNodes`, the indexer's `nodes.rs`, the
TypeScript node helpers and the gateway all grow a per-platform case, and
every Google node changes. None of the networks in `chain-configurations`
deploys `IdentityNames` today, so there is no Google namespace to migrate,
but the case is permanent code and permanent audit surface.

**Poseidon.** Cheapest in a circuit and no precedent anywhere in libID's
Solidity, Rust or TypeScript. The contract would compute Poseidon in `_write`
and `resolveHandle`, and so would the gateway. Not for this design.

Measured on a scratch copy of the circuit at the pinned toolchain, with the
fold-and-shape loop included in both variants (`nargo compile`, then
`bb gates --oracle_hash keccak`):

| Circuit | ACIR opcodes | Honk gates | Delta |
|---|---|---|---|
| today | 44,612 | 179,443 | |
| fold + SHA-256 | 49,918 | 192,254 | +7.1% |
| fold + keccak256 (library v0.1.3) | 49,911 | 203,878 | +13.6% |

Proving time was not measured; it grows roughly with the gate count. The
recommendation is keccak256: a seventh more proving work in the browser
against no change to any node, any reader, or any invariant. SHA-256 is the
fallback if the browser prover's time budget cannot take it, and then the
per-platform inner hash is written into the spec as a Google exception.

### The account id, `sub`

The same treatment, with the validation moving where the bytes are:
`sub_hash: pub [Field; 2]` replaces `sub_packed`, keccak256 over the signed
`sub` bytes exactly as signed, since the spec keeps the id case-sensitive and
untransformed (`platform-ceremonies.md` §2.1: "its exact 1–255
case-sensitive ASCII bytes"), so the digest is the inner hash of `idNode`
(`IdentityNodes.sol:32-34`) and that node does not change either.

Today the circuit checks the `sub` bytes against the payload, refuses an
interior quote and pins the padding to zero (`main.nr:177-192`), and leaves
emptiness to the verifier, which rejects an empty `userId` after unpacking
(`GooglePlatformVerifier.sol:234`). A verifier that receives a digest can
inspect nothing, so the circuit takes over the whole of the id's validation,
which REQ-PLAT-04 already states for every implementation: `sub_len` at
least 1; every byte within `sub_len` in `0x20` through `0x7e`, so no control
byte, no non-ASCII byte and, as today, no quote; the padding zero; and the
digest over exactly `sub_len` bytes. `SUB_MAX` stays a profile
constant: 31 today, a Google `sub` being 21 digits, and a `sub` longer than
the constant fails to prove rather than truncating. The spec's 255 is the
identity's general bound, not this profile's; raising `SUB_MAX` to it costs
a second keccak block and is a measurement away if a longer Google `sub`
ever appears. A 32-byte digest needs two field elements where the packed id
needed one, so the public-input count becomes 57 and the offsets after slot
34 move by one. Measured the same way as above, the two digests together
cost:

| Circuit | ACIR opcodes | Honk gates | Delta |
|---|---|---|---|
| fold + keccak256 of the email, keccak256 of `sub` | 50,375 | 223,582 | +24.6% |

A quarter more proving work than today, against a wallet that no longer
joins with every relying party's user table.

### Where the mode lives

**In the operation the user authorizes, carried out by the presence of the
plaintext.** The Consumer's Authorized Transaction Data for a claim is the
triple `(target, feeAmount, feeReceiver)` (`IdentityNames.sol:481-491`); it
becomes `(target, feeAmount, feeReceiver, disclose)`, so the choice is
committed in the Authorization Digest the way the fee is, and the user sees
it when they consent. A platform that exposes bytes has only one true
answer, and its claims carry `disclose = true`. `GoogleProof` gains
`bytes userId` and `bytes email` beside `clientIdentifier`
(`GooglePlatformVerifier.sol:76-84`), both present exactly when `disclose`
says so. The Canonical Runtime fills them from the ID Token it verified,
and hands the email to the application only for a disclosing claim, so an
application that asked for a private one has nothing to attach.

The verifier passes the submitted bytes through, marked unverified, and
returns the two digests the proof bound as new `VerifiedClaim.userIdHash`
and `handleHash`; it checks nothing about the bytes, because the check
needs the handle normalized and normalization is the Consumer's
(REQ-PLAT-08B). `IdentityNames._write` is the one place the equality holds:
it derives both nodes from the digests in both modes; it refuses plaintext
that `disclose` does not authorize, a missing plaintext it does, and one of
the two without the other; when the plaintext is present it normalizes the
handle, requires `keccak256(bytes(userId)) == userIdHash` and
`keccak256(bytes(normalized)) == handleHash`, and only then stores or
emits the strings, the handle normalized. `publishName` without plaintext
reverts. X and GitHub verifiers return zero digests and keep the plaintext
path they have. **Recommended.** It keeps REQ-PLAT-08B honest in the form
that matters: the Consumer still derives the key from a proof-bound value
and still refuses a caller-supplied key; the plaintext is accepted only
because the proof binds its digest and the user authorized sending it.

**The presence of the plaintext alone, chosen at submission time.**
Rejected. The application assembles the transaction, and whoever assembles
it would decide whether the address is published; the application operator
is trusted with no identity field (`libid.md`, roles). The cost of the
recommendation is that the choice is fixed before proving; making a
private binding public later is the `publish` call below, and nothing
turns a public one private anyway.

**A mode bit as a circuit public input.** Rejected. It costs an input and
adds nothing the Authorization Digest does not already commit.

The event gains `bool disclosed` and keeps `string userId` and `string
handle`, both empty when private. `disclosed` is a fact about the event:
this event carries the plaintext. It says nothing about earlier events, and
it cannot, because a plaintext once emitted is public for good. An empty
string is unambiguous, since the normalizer rejects an empty handle, but the
bool is what an indexer reads without parsing. A separate indexed
`handleHash` would duplicate `handleNode`.

### Default, and moving between modes

**Google is private unless the user sends the plaintext.** That is the premise
of this note. Public by default with a private opt-in would leave §12's
rationale intact and is recorded here only as the alternative not taken.

**X and GitHub stay as they are.** Their handles are public on the platform
by construction, their circuits reveal transcript bytes the notary attested,
and §12's reasoning holds for them. The zero `handleHash` leaves the door
open.

**Private to public, later.** By decision a call, not a new claim, and the
contract already has its inverse, `unpublish`, so the call is
`publish(platformId, string userId, string handle)`: normalize the handle,
derive both nodes, require that the caller owns them and that the binding is
live, set `published`, emit `IdentityPublished(owner, platformId, idNode,
handleNode, userId, handle)`. No proof is needed; the preimages are the
proof. The address is public from the block the call is sent in, whether
or not it is accepted: a refused `publish` still leaves its calldata on
chain.

A handle is retired when the same account claims again under another one:
the old node's owner is cleared and `HandleRetired` emitted
(`IdentityNames.sol:660-667`), and the old name is free for another account
to take. `publish` refuses a retired handle, by decision, however well the
caller knows its preimage. Accepting would have emitted the
plaintext of an address the wallet no longer holds and set `published` to
it, so `reverseOf`, which returns the stored string as it is (`:770`), would
name that address until the next claim; `primaryOf` already refuses a
published string whose node the wallet does not own (`:787-792`). So
`publish` requires the pairing in both directions, `handleOfId[idNode] ==
handleNode` and `idOfHandle[handleNode] == idNode`, and the wallet to own
both nodes. One direction is not enough: a wallet holding two Google
accounts, whose first account's handle was reassigned to its second, owns
both of the first account's nodes while `handleOfId` still names the
retired handle, and only `idOfHandle` says the handle is the second
account's now. The owner of a private binding can publish exactly what
they hold.

The same scenario settles one more rule. A claim from a wallet that has
already published refreshes the published string to the handle just proved,
so a rename never leaves a stale name on display (`:626-633`). A private
claim carries no plaintext to refresh with. When it re-proves the handle
already published, whose normalized string hashes to the claim's
`handleHash`, the publication stays, as the contract already keeps a
display a `publishName: false` claim still vouches for; when it proves
another handle, it deletes the publication, or `reverseOf` would keep
showing the old address after the account moved on.

Two facts therefore live apart. **Disclosure** is history: once any event
has carried an identity's plaintext, a private claim, a private refresh of
the same nodes, or `unpublish` afterwards, the plaintext is known and stays
known. **Publication** is state: whether the wallet currently displays the
name, set by `publishName` on a disclosed claim or by `publish`, cleared by
`unpublish` or by a private claim of another handle. The sequence private claim, `publish`,
private refresh ends with the plaintext known, the publication cleared, and
the last event saying `disclosed: false`, all three true at once.

**Public to private.** Impossible, and the note should say so where users
read it. The log line exists. `unpublish` already documents this for the
storage string; the same sentence covers the event.

### Downstream

**usernames-indexer.** `names.handles.handle` and `names.ids.user_id` become
nullable and `names.published` stays plaintext, since only a disclosed
binding can be published. `resolve_handle` currently selects `WHERE h.handle = $3`
(`handle_lookup`, `usernames-core/src/db.rs:1186-1199`) and moves to the node: fold the query,
normalize, derive `handleNode` with the function the indexer already has
(`nodes.rs`), select by node. `/v1/search` excludes private bindings by
construction, since there is no text to match. The recompute check that
compares a re-derived node with the emitted topic (`db.rs:791-798`) skips the
handle and the id when the event carries none; `/v1/resolve/id` moves to
the node the same way. The indexer keeps the two facts apart as the
contract does: `IdentityPublished` fills a `names.ids` or `names.handles`
row whose plaintext was null and sets `names.published`; a later private
event never nulls a plaintext row, only `names.published` follows the
publication state. Responses carry `disclosed`, meaning the plaintext of
this identity is known, from any event that ever carried it, and
`published`, the current state; a private-only identity returns `handle:
null` and `userId: null`. The resolve routes keep the plaintext in the path,
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
string; it becomes optional, absent for private. Client-side normalization
must produce the bytes the circuit hashes, and `handle.ts` already
reproduces the shared vector table, so the only new obligation is that the
circuit input builder feeds the circuit the raw bytes and expects the digest
of the folded ones. The local result carries the email only for a
disclosing claim (REQ-PLAT-03); for a private one the application receives
the digests, and the email stays inside the Canonical Runtime.

**Demo.** The "publish the handle on chain" checkbox becomes a three-way
choice made before the ceremony starts, since `disclose` is in the digest:
private, public, public and published.

### Spec changes

Written, on this branch. The map, for a reader coming from the specs:

- `platform-ceremonies.md`: §2.1a's lead-in and REQ-PLAT-08A/08B admit a
  circuit that normalizes what it digests, refusing where the table trims,
  and a Consumer that keys on digests and normalizes every handle it
  receives. A new §2.1b defines disclosure (history) and publication
  (state), and holds REQ-PLAT-08D (keys from the digests, the disclosure
  choice in the Authorized Transaction Data, plaintext only when authorized
  and only when it hashes to the digests, both or neither, a private claim
  keeping or clearing the publication), 08E (the disclosure call, its
  two-way pairing check, and what a refusal does not protect), 08F (the
  event's disclosed flag, the normalized handle), 08G (rules fixed once a
  digest platform has bound anything) and TEST-PLAT-20A. REQ-PLAT-03 has
  the Canonical Runtime release the plaintext only for a disclosing claim;
  REQ-PLAT-04 and 16D refuse a backslash in `sub`; REQ-PLAT-16B lists the
  two digests as public inputs; 16C has the verifier return them and pass
  plaintext through unchecked; 16D moves the `sub` and `email` validation
  into the circuit and states the 31- and 62-byte buffers; TEST-PLAT-06A
  exercises the three; §9 states what the digests protect and what they do
  not. The Google profile stays Platform Ceremony Version 1: nothing is
  released, so its statement is edited in place.
- `ceremony-common.md`: ASM-HASH-01, ASM-ZK-01, SP-PRIV-01 (plaintext
  reaches the chain only in a transaction that discloses it), REQ-COMMON-05E
  returns the digests, and the plaintext marked unverified, where a profile
  exposes digests; REQ-COMMON-45 selects only zero-knowledge artifacts for
  a digest profile; §12 replaces "published deliberately" for the handle
  and user identifier with the digest profile's confidentiality and its
  limits.
- `libid.md`: one sentence among the enforceable guarantees.

## The recommendation

Hash in the circuit, normalize in the circuit, keccak256 over the email and
over `sub`, the mode chosen by the user in the authorized operation and
carried out by the presence of the plaintexts, private by default for
Google alone, `publish` to go public later, ENS forward names
resolving for private bindings as for public ones, and the resolve routes as
they are. This is the one combination where neither the email nor the
account id reaches calldata, where both nodes are identical across modes
and readers, where the verifier reuses a pattern it already has for
the audience, and where the payload change is two optional fields.

It does not protect against confirmation of a suspected address or account
id by whoever already holds it, the query plaintext in the indexer's access
logs, or the visibility of the binding itself.

## What to implement, in order

1. **Spec** (`libid`): the amendments above, and a note on the vector table
   that the trim rows do not apply to the circuit, which refuses a space
   instead. Done when a reader can follow the new property to its
   requirements and its test.
2. **Circuit** (`libid-circuits`): the fold-and-shape loop, the keccak
   library, `handle_hash` in place of `email_packed` and `sub_hash` in place
   of `sub_packed`, a gate count in the commit. Done when `Alice@Gmail.com`
   and `alice@gmail.com` prove the same digest, and a space, two `@`, an
   empty local part and a garbage tail each fail to prove.
3. **Contracts** (`libid-contracts`): the Google verifier regenerated, `bytes
   userId` and `bytes email` in the payload, `userIdHash` and `handleHash`
   in `VerifiedClaim`, `disclose` in the claim's Authorized Transaction
   Data, the equality checks and the hash-derived nodes in `_write`,
   `disclosed` in the event, `publish` with its two-way pairing check,
   `setPlatform` refusing a Google rules change once Google has bound
   anything, the circuit pin. Done when
   the same account claimed public and then private lands on the same two
   nodes; when a private transaction, made with recognizable test values,
   carries no plaintext email or account id in its decoded calldata or its
   decoded events, the payload fields being empty and the event strings
   empty, rather than a byte search over proof bytes that can contain
   anything; and when `publishName` without plaintext, plaintext `disclose`
   does not authorize, and a `publish` of a pair either direction of the
   mapping disputes all revert.
4. **Indexer, SDK, demo**: nullable handle and id, node-keyed resolve for
   both, `IdentityPublished` filling the plaintext rows and the publication
   state, optional `userId` and `email`, the three-way choice. Done when
   resolve finds a private binding by exact address or account id, search
   never returns it, `reverseOf` is empty for it, and the sequence private
   claim, `publish`, private refresh reads back as known, unpublished,
   last event undisclosed. The node-keyed lookups are proven against the
   chain, not against a hand-computed hash: one test claims on a local
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

## Open decisions

Decided: `alice.google.handles.link` resolves for a private binding, so the
name is the address and a wallet that resolves it has confirmed it, and with
it that confirming a suspected address by hashing it is accepted; `sub` is
hidden with the handle; private to public is a `publish` call, not a new
claim; the resolve routes keep the plaintext in the
request line, the indexer's operator being trusted with what people resolve;
`publish` refuses a handle retired by a later claim of the same account, or
taken over by another account of the same wallet, as set out under
"Default, and moving between modes"; the user, not the application,
chooses disclosure, in the Authorized Transaction Data; a private claim of
the published handle keeps the publication; Google's handle rules are
fixed once Google has bound anything; and the verifier artifact is
zero-knowledge, which the privacy rests on as much as on the hash.

Nothing in this note is left open.

The indexer and the deployer derive nodes and platform ids from the same
generated table the contract's constants come from (`libid-identity`
0.13, `usernames-indexer` `Cargo.toml:20-22`, `libid-deploy`
`platforms.rs:174-206`), and the indexer's pinned vectors reproduce the
contract's derivation (`nodes.rs:302-320`). Nothing needs aligning before
the node-keyed lookups; the test above keeps it that way.

## Sources

Line numbers are against each repository's `origin/main` on 2026-09-22
unless a revision is named; spec references are against `libid`
`origin/main` at `002c201`.

- `specs/platform-ceremonies.md`: REQ-PLAT-08A/08B/08C and TEST-PLAT-20
  (134-166), REQ-PLAT-16B (298-313), REQ-PLAT-19A (322-328), REQ-PLAT-20.
- `specs/ceremony-common.md`: REQ-COMMON-05E (553-561), §12 privacy
  statement (1497-1500).
- `libid-circuits/circuits/oidc-google/src/main.nr`: public inputs (87-97),
  email checks (125-147), audience hash (259-267), email packing (290-307);
  `circuits/bearer-link/src/main.nr:51-70` (`verify_hash_commit`);
  `toolchain.env`.
- `libid-contracts/solidity/contracts/ceremony/GooglePlatformVerifier.sol`:
  offsets (43-50), `GoogleProof` (76-84), audience check (206-210), handle
  (237); `ceremony/ICeremony.sol:66-84` (`VerifiedClaim`);
  `identity/IdentityNames.sol`: invariant (106-112), event (267-277),
  `_write` (600-640), `unpublish` (678-686); `identity/IdentityNodes.sol`
  (25-41); `identity/HandleNormalizer.sol` (100-148);
  `identity/handles.json` (google, 52-73).
- `usernames-indexer` at `origin/main` `bec6765`, `crates/usernames-core`:
  `migrations/001_schema.sql` (47, 73, 83-91), `src/db.rs` (791-798,
  1091-1100, 1133, 1186-1199), `src/api/mod.rs` (79-84), `src/ens.rs`
  (500-542), `src/nodes.rs` (241-243, 302-320); `bin/usernames-api/src/ens.rs`
  (416). `chain-configurations` at `origin/main` `f15832a`:
  `bin/libid-deploy/src/platforms.rs` (174-206).
- Gate counts: `nargo info` and `bb gates` on scratch copies of the circuit
  at nargo 1.0.0-beta.25 and bb 5.2.0, with `noir-lang/keccak256` v0.1.3.
