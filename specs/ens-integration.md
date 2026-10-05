---
title: ENS integration
sidebar:
  order: 5
---

# ENS integration

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document is the normative owner of how a libID binding is read as an ENS
name: the name grammar under the Parent Name, the transform between a handle
and its labels, the Handle Resolver contract on the ENS chain, and the Gateway
that answers the resolver's offchain lookups.

The integration projects state that already exists. A name is derived from a
binding in the `IdentityRegistry` of a Consumer Chain; nothing is registered,
minted, or stored per name, and nothing here writes to any `IdentityRegistry`.
The authoritative record is the binding. An ENS name is a way to read it.

It does not own the binding itself, handle normalization (`HandleNormalizer`,
under the platform's rules), the indexer that mirrors each chain, the DNS
zone's operation, or wallet behavior before the Gateway is called.

## 2. Terminology

Parent Name: The name a deployment's names sit under, a deployment
   parameter: `handles.link` in production, which is a DNS name imported into
   the ENS registry on the ENS Chain through the ENS DNS registrar. A test
   deployment may use a name under it, such as `testnet.handles.link`. Every
   label of the Parent Name matches `[a-z0-9-]+`.

ENS Chain: The chain whose ENS registry holds the Parent Name: Ethereum
   mainnet for a production deployment, an Ethereum test network that hosts
   the ENS registry for a test deployment. The Gateway is configured with its
   chain ID.

Handle Resolver: The contract set as the resolver of the Parent Name. It holds
   no names.

Gateway: The HTTP service named in the Handle Resolver's URL list. It reads
   the Indexed Store and signs answers.

Indexed Store: The mirror of every indexed Consumer Chain's `IdentityRegistry`
   that `usernames-indexer` writes, with each chain's index position and
   indexer report.

Platform Label: One of `x`, `github`, `google`. It names the platform whose
   Platform ID the `IdentityRegistry` registers for that key.

Chain Label: A label naming one Consumer Chain. The set of Chain Labels is
   deployment data in the Indexed Store.

Handle Labels: The labels a handle becomes under §6.

Coin Type: The ENSIP-11 coin type a client asks with. `60` is the coin of
   the ENS Chain, and `addr(bytes32)` asks with `60`; an EVM chain `c` is
   `0x80000000 | c`.

Signer: An address the Handle Resolver trusts to sign Gateway answers.

Signed Null: A signed answer that the queried record does not exist.

Refusal: An unsigned HTTP error. It asserts nothing about any binding.

## 3. Assumptions

- ASM-ENS-01:
  A client resolving a name implements ENSIP-10 wildcard resolution, ERC-3668
  CCIP-Read, and ENSIP-11 chain address resolution. A client lacking one of
  them reports an error or asks only for coin type 60; it never receives an
  address for a chain it did not ask about.
- ASM-ENS-02:
  A client applies ENSIP-15 normalization before hashing a name, so the
  Handle Resolver and the Gateway receive normalized labels.
- ASM-ENS-03:
  The Indexed Store reflects each indexed chain's `IdentityRegistry` up to
  the index position it records, and the indexer report it carries is
  current while unexpired.
- ASM-ENS-04:
  Each Signer's private key is known only to the Gateway operator.
- ASM-ENS-05:
  Whoever controls the DNS registration and DNSSEC keys of `handles.link`
  controls it in ENS, and with it every Parent Name under it: a later valid
  DNSSEC proof overwrites its owner.

## 4. Security properties

- SP-ENS-01:
  The Handle Resolver returns an answer only when a current Signer signed
  that exact answer, for that exact query, for that resolver's address, and
  the answer has not expired. An answer cannot be replayed for another name,
  another record, a resolver at another address, or after its deadline.
  Depends on ASM-ENS-04 and REQ-ENS-KEY-02.
- SP-ENS-02:
  A signed address is the holder the Indexed Store records for the handle on
  the one chain the Coin Type names. Depends on ASM-ENS-03.
- SP-ENS-03:
  The Gateway never signs absence it does not know: a chain it does not
  index, a Coin Type two indexed chains share, and an index too far behind
  each get a Refusal, never a Signed Null. Depends on the Gateway's handle
  rules admitting every handle an indexed chain binds (§11).
- SP-ENS-04:
  No two handles reach one name, and a name carries its handle: the Gateway
  reads a name with no mapping table.
- SP-ENS-05:
  A name never widens to another chain. A Chain Label only narrows the Coin
  Type's answer.

These properties do not survive compromise of a Signer key, which can answer
with any address (§10).

## 5. Names

```text
name = handleLabels "." platformLabel [ "." chainLabel ] "." parentName
```

With the production Parent Name `handles.link`:

```text
alice.x.handles.link                  short form
alice.x.base.handles.link             with a Chain Label
alice.smith.google.handles.link       Gmail
alice._at.company.com.google.handles.link
                                      Google Workspace
```

- REQ-ENS-NAME-01 (upholds SP-ENS-04):
  Platform Labels and Chain Labels MUST be disjoint sets. A Chain Label MUST
  match `[a-z0-9-]+`, be at most 63 bytes, and not have `-` as both its third
  and fourth characters. Necessity: the parse below tells the two apart only
  by membership, and a Chain Label outside DNS or ENSIP-15 is one no client
  sends.
- REQ-ENS-NAME-02 (upholds SP-ENS-04):
  A name MUST be parsed right to left. After the Parent Name's labels, the
  last label is the Platform Label if it is one; otherwise it is the Chain Label and the
  label before it is the Platform Label. Every remaining label is a Handle
  Label. Necessity: a Gmail or Workspace handle contributes a variable number
  of labels, so only the right end has fixed positions.
- REQ-ENS-NAME-03 (upholds SP-ENS-05):
  A name with a Chain Label MUST be answered only when the Coin Type names
  the chain that label names. A name without one is answered for the chain
  the Coin Type names.
- REQ-ENS-NAME-04:
  A name MUST be DNS wire format: labels of 1 to 63 bytes, each valid UTF-8,
  ended by the root label with no bytes after it. A label containing an
  uppercase letter or a byte at or below `0x20` is not a name any handle
  produces; the Gateway answers an `addr` call for it under REQ-ENS-GW-05.

## 6. Handle labels

The transform takes the handle `HandleNormalizer` produced under the
platform's rules, never raw input. It returns Handle Labels or refuses. A
refused handle has no name; its binding stays readable through the
`IdentityRegistry` and by address.

Every Handle Label also satisfies REQ-ENS-NAME-04, so the transform refuses
a handle that would give a label longer than 63 bytes. Two ENSIP-15 rules
shape the labels below: `_` may appear only at the start of a label, and a
label's third and fourth characters must not both be `-`. The rules below
keep every Handle Label within both, so ENSIP-15 leaves every name they
produce unchanged.

- REQ-ENS-LABEL-01 (X):
  The Handle Labels of an X handle are one label: the handle with every `_`
  replaced by `-`. The transform MUST refuse a handle containing `-`, and a
  handle whose third and fourth characters are both `_`. Necessity: the
  substitution reverses exactly only while no handle holds `-`. X issues
  none, but a chain's rules can be widened to admit it, and the refusal keeps
  every name reversible then; the second refusal is ENSIP-15's `/^..--/`
  rule.
- REQ-ENS-LABEL-02 (GitHub):
  The Handle Labels of a GitHub handle are one label: the handle unchanged.
  The transform MUST refuse a handle containing `_`, and a handle whose
  third and fourth characters are both `-`. Necessity: GitHub issues
  neither, so no ENSIP-15 rule fires on a GitHub handle; a chain's rules can
  be widened to admit them, and the refusals keep every name within ENSIP-15
  then.
- REQ-ENS-LABEL-03 (Gmail):
  For a Google handle whose domain is `gmail.com`, the Handle Labels are the
  local part split at every `.`. The transform MUST refuse a local part not
  matching `^[a-z0-9]+(\.[a-z0-9]+)*$`. Necessity: Gmail issues only that
  alphabet; a mapping for characters no account can hold would be untested
  code on a payment path.
- REQ-ENS-LABEL-04 (Google Workspace):
  For any other Google handle, the Handle Labels are the local part split at
  `.`, then `_at`, then the domain split at `.`. Every label other than
  `_at` MUST be non-empty and match `[a-z0-9-]+`, and the transform MUST
  refuse a handle with a label whose third and fourth characters are both
  `-`, such as the local part `ab--x` or the IDNA domain label
  `xn--bcher-kva`. Necessity: joining local part and domain with dots alone
  is ambiguous (`a.b@c.com`, `a@b.c.com`); `_at` cannot collide with a
  Handle Label, because a leading `_` is the only one ENSIP-15 admits and no
  other Handle Label holds one; and ENSIP-15 refuses a label matching
  `/^..--/`, so no client could send such a name.
- REQ-ENS-LABEL-05 (upholds SP-ENS-04):
  The Gateway MUST read Handle Labels by the exact inverse of
  REQ-ENS-LABEL-01 to -04, run the result through the platform's handle
  rules built into the Gateway, which are the same for every chain, and
  answer a Signed Null when either step fails. It SHOULD answer a Signed Null
  for labels outside the transform's image, such as an X or Workspace label
  with `--` at the third and fourth characters, or `_at` followed by
  `gmail.com`.
  Necessity: the labels carry the handle, so no table maps names to handles;
  the inverse is the only reading.

## 7. Handle Resolver

- REQ-ENS-RES-01:
  The Handle Resolver MUST be the resolver of the Parent Name and MUST hold
  no per-name state. It MUST answer `supportsInterface` true for ENSIP-10
  `IExtendedResolver` (`0x9061b923`) and ERC-165 (`0x01ffc9a7`) only.
  Necessity: announcing ERC-7996 makes the ENS Universal Resolver raise the
  lookup under its own address (ENSIP-22), which the Gateway refuses under
  REQ-ENS-GW-08.
- REQ-ENS-RES-02:
  `resolve(bytes name, bytes data)` MUST revert with ERC-3668
  `OffchainLookup(address(this), urls, callData, resolveWithProof.selector,
  callData)`, where `callData` is the `resolve` call as received. It MUST
  revert `NoUrls()` when the URL list is empty.
- REQ-ENS-RES-03 (upholds SP-ENS-01):
  `resolveWithProof(bytes response, bytes extraData)` MUST decode
  `(bytes result, uint64 expires, bytes signature)` from `response` and
  return `result` only if `expires >= block.timestamp`,
  `expires <= block.timestamp + 3600`, and the address recovered from
  `signature` over the digest below is a Signer:

  ```text
  digest = keccak256(0x19 ‖ 0x00 ‖ resolver ‖ U64BE(expires)
                     ‖ keccak256(extraData) ‖ keccak256(result))
  ```

  where `resolver` is the Handle Resolver's 20-byte address. `signature` is
  the encoding OpenZeppelin `ECDSA.recover` accepts: 65 bytes `r ‖ s ‖ v`,
  with `v` 27 or 28 and `s` at most half the secp256k1 group order. It
  reverts `SignatureExpired`, `DeadlineTooFar`, or `UntrustedSigner` when a
  check fails. A malformed answer reverts too: a `response` that does not
  decode reverts in `abi.decode`, and a `signature` outside that encoding
  reverts `ECDSAInvalidSignatureLength`, `ECDSAInvalidSignatureS`, or
  `ECDSAInvalidSignature`. A client treats any revert as a rejected answer.
  Necessity: the resolver address binds the answer to one resolver, the
  request hash to one query, the result hash to one answer, and the ceiling
  stops a leaked answer living indefinitely.
- REQ-ENS-RES-04:
  Only the owner MAY replace the URL list or add or remove a Signer.
  Ownership MUST transfer in two steps and MUST NOT be renounceable. The
  Handle Resolver is not upgradeable; it is replaced by setting another
  resolver on the Parent Name.
- REQ-ENS-RES-05:
  Every URL in the Handle Resolver's list MUST contain both `{sender}` and
  `{data}`, in the `{base}/{sender}/{data}` form of REQ-ENS-GW-01.
  Necessity: an ERC-3668 client sends a POST to a URL without `{data}`, and
  the Gateway serves GET only, so such a URL answers nothing.

## 8. Gateway

### 8.1 Requests

- REQ-ENS-GW-01:
  The Gateway MUST serve `GET {base}/{sender}/{data}`, where `{data}` is the
  hex `callData` of REQ-ENS-RES-02, with or without `0x` and a `.json`
  suffix. A `{data}` that is not hex, not a `resolve` call, or not decodable
  MUST get HTTP 400.
- REQ-ENS-GW-02:
  The Gateway MUST answer HTTP 400 for a name violating REQ-ENS-NAME-04's
  wire rules, a label that is not UTF-8 among them, and for a name outside
  its Parent Name, whatever the record. It MUST answer HTTP 400 for an `addr`
  call whose node is not the namehash of the name. For any other record it
  answers the signed empty result of REQ-ENS-GW-07 without comparing the
  node. Necessity: the first are malformed queries, not names; and a node
  that differs from the name means the client and the Gateway normalized
  differently, which must not be signed as an address. The empty result
  asserts nothing about the node.

### 8.2 Choosing the chain

- REQ-ENS-GW-03 (upholds SP-ENS-02, SP-ENS-03):
  The Gateway MUST match the Coin Type forward against the chain IDs in the
  Indexed Store: chain `c` matches `0x80000000 | c`, and the ENS Chain also
  matches `60`. It MUST NOT decode a Coin Type into a chain ID. Exactly one
  match selects that chain. Necessity: `0x80000000 | c` is not injective for
  `c >= 2^31`, so decoding would answer for a different chain; and a client
  that asks with `60` sends on the chain whose registry it asked, so `60`
  through a test network's registry is that test network, never chain 1.
- REQ-ENS-GW-04 (upholds SP-ENS-03):
  With no match, the Gateway MUST return a Refusal (HTTP 503) when the Coin
  Type names an EVM chain, and a Signed Null otherwise. A Coin Type names an
  EVM chain when it is below 2^64 and is `60` or has bit 31 set; every Coin
  Type at or above 2^64 is non-EVM, and no indexed chain matches one, because
  the Indexed Store holds chain IDs below 2^64 only. With two or more matches
  the Gateway MUST return a Refusal (HTTP 503). Necessity: the resolver has
  one URL list for every query, and ERC-3668 has the client walk it until
  one succeeds. A Signed Null is a success that ends the walk,
  so signing absence for a chain this Gateway does not hold would deny a
  binding a later Gateway in the list could serve. No libID binding is ever
  a non-EVM address, so that absence is known.
- REQ-ENS-GW-05 (upholds SP-ENS-05):
  Once a chain is selected, a name the Gateway cannot parse, Handle Labels
  the inverse in REQ-ENS-LABEL-05 refuses, and a Chain Label not naming the
  selected chain MUST each get a Signed Null.
- REQ-ENS-GW-06 (upholds SP-ENS-03):
  Before applying the handle rules or reading a holder, the Gateway MUST
  return a Refusal (HTTP 503) when the selected chain's index is more than
  the deployment's maximum lag behind, or its indexer report has expired or
  is unknown. Necessity: a stale index
  can deny a binding that already exists.

### 8.3 Answers

- REQ-ENS-GW-07 (upholds SP-ENS-02):
  The answer is the holder the Indexed Store records for the handle node on
  the selected chain, encoded per record:

  | record | answer | none |
  |---|---|---|
  | `addr(bytes32)` | ABI `address` | the zero address |
  | `addr(bytes32,uint256)` | ABI `bytes`, 20 bytes | empty bytes |
  | any other selector | empty result | — |

  An `addr` call whose arguments do not decode gets the empty result.
- REQ-ENS-GW-08 (upholds SP-ENS-01):
  The Gateway MUST sign the REQ-ENS-RES-03 digest with `resolver` set to the
  Handle Resolver address it is configured to serve, never the `{sender}` of
  the request, and with `expires` at most 3300 seconds after signing. It
  MUST sign the digest itself, with no further prefix, and encode the
  signature as REQ-ENS-RES-03 requires. It MAY refuse a `{sender}` that is
  not that address with HTTP 400, comparing addresses case-insensitively. Necessity: on the Universal Resolver's
  direct-call route `{sender}` names the Universal Resolver, and the 300 s
  below the resolver's ceiling absorbs clock skew between Gateway and chain.
- REQ-ENS-GW-09:
  A successful response MUST be HTTP 200 with body
  `{"data": "0x" ‖ hex(abi.encode(bytes result, uint64 expires, bytes signature))}`.
  A Refusal or error MUST carry no signature.
- REQ-ENS-GW-10:
  Every response, errors included, MUST carry
  `Access-Control-Allow-Origin: *`. Necessity: the mainnet Universal
  Resolver's `x-batch-gateway:true` entry makes the client fetch the Gateway
  from the wallet's page; without the header the page never sees the answer.
  The answers are public and signed, and no credentials are sent.

### 8.4 Order

- REQ-ENS-GW-11 (upholds SP-ENS-03):
  The Gateway MUST take these steps in order, and the first that answers
  ends the request:

  1. `{sender}` (REQ-ENS-GW-08) and `{data}` (REQ-ENS-GW-01): HTTP 400.
  2. The name's wire rules and Parent Name (REQ-ENS-GW-02): HTTP 400.
  3. A record other than `addr`: the signed empty result.
  4. An `addr` node that is not the name's namehash: HTTP 400.
  5. Choosing the chain (REQ-ENS-GW-03, REQ-ENS-GW-04): a Refusal, or a
     Signed Null for a non-EVM Coin Type.
  6. The Signed Nulls of REQ-ENS-GW-05.
  7. Staleness (REQ-ENS-GW-06): a Refusal.
  8. The handle rules of REQ-ENS-LABEL-05: a Signed Null.
  9. The holder (REQ-ENS-GW-07).

  Necessity: a chain the Gateway does not serve keeps its Refusal, so the
  client walks on to a Gateway that may read the name; and no step before
  staleness reads a binding.

  Consequence: a record other than `addr` gets its signed empty result
  whatever the Coin Type and however stale the index, and the Signed Nulls of
  REQ-ENS-GW-05 are signed while the selected chain's index is stale or its
  report has expired or is unknown. Those answers depend on the name, the
  Coin Type and the Chain Labels the Indexed Store holds when asked, never on
  a binding. A handle the rules refuse, and every holder, is answered only
  from an index that passes REQ-ENS-GW-06.

## 9. Keys

- REQ-ENS-KEY-01:
  The DNS registrar account with the DNSSEC keys, the owner of the Parent
  Name and the Handle Resolver, and each Signer MUST be distinct keys.

  | key | grants | lives |
  |---|---|---|
  | DNS registrar account and DNSSEC keys | the Parent Name (ASM-ENS-05) | DNS provider |
  | Parent Name and Handle Resolver owner | resolver, URL list, Signers | cold |
  | Signer | answers | Gateway host |

  Necessity: a URL without a Signer key buys nothing, because the callback
  rejects its answer; a Signer key answers anything; the DNS credentials take
  the whole namespace. Held together, the least guarded one decides all
  three.
- REQ-ENS-KEY-02 (upholds SP-ENS-01):
  Handle Resolvers that trust one Signer MUST sit at different addresses,
  whichever chains they are on. Necessity: the digest binds an answer to its
  resolver's address and not to a chain, so one Signer may serve resolvers
  on several chains only while their addresses differ.

## 10. Conformance

- TEST-ENS-01 (exercises REQ-ENS-LABEL-01 to -05):
  Forward and inverse vectors for each platform round-trip; `a__b` maps to
  `a--b` and `ab__cd` is refused; a Gmail local part with `+`, `-` or `_` is
  refused; the X handle `a-b`, and the GitHub handles `a_b` and `ab--c`,
  have no name; `a.b@c.com` and `a@b.c.com` give different names;
  `ab--x@company.com` and `alice@xn--bcher-kva.example` have no name.
- TEST-ENS-02 (exercises REQ-ENS-RES-03, REQ-ENS-GW-08):
  One digest vector reproduces in the Handle Resolver and the Gateway; the
  callback rejects an expired answer, one past the ceiling, an untrusted
  Signer, an answer signed for another resolver address, a 64-byte
  signature, a signature with `v` 0 or 1, and one with a high `s`.
- TEST-ENS-03 (exercises REQ-ENS-GW-03 to -06):
  An unindexed EVM Coin Type, coin type 60 without the ENS Chain indexed,
  two chains sharing one Coin Type, and a stale index each get a Refusal; a
  non-EVM Coin Type (`0`, and `2^64 | 0x80000000`), an unknown Handle Label,
  and a mismatched Chain Label each get a Signed Null. With the ENS Chain set
  to Sepolia (11155111) and both Sepolia and chain 1 indexed, coin type 60
  selects Sepolia.
- TEST-ENS-04 (exercises REQ-ENS-GW-07, REQ-ENS-GW-09, REQ-ENS-GW-10):
  Both `addr` shapes answer a bound and an unbound handle; a `text` call gets
  the signed empty result; a 200 and a Refusal both carry
  `Access-Control-Allow-Origin: *`.
- TEST-ENS-05 (exercises SP-ENS-01, SP-ENS-02 end to end):
  A name resolves through the ENS Universal Resolver on the ENS Chain, with
  the batch gateway played by the test. The same name fails with CCIP-Read
  disabled on the client, which shows the answer came offchain.
- TEST-ENS-06 (exercises REQ-ENS-NAME-02, REQ-ENS-GW-02):
  With the Parent Name `testnet.handles.link`, `alice.x.testnet.handles.link`
  reads as the X handle `alice` with no Chain Label,
  `alice.x.sepolia.testnet.handles.link` carries the Chain Label `sepolia`,
  and `alice.x.handles.link` gets HTTP 400.
- TEST-ENS-07 (exercises REQ-ENS-NAME-04, REQ-ENS-GW-02, REQ-ENS-GW-11):
  A name with a label that is not UTF-8, and an `addr` call whose node is
  not the name's namehash, each get HTTP 400; a `text` call whose node is not
  the name's namehash gets the signed empty result; with the selected
  chain's index stale, a mismatched Chain Label gets a Signed Null and a
  readable handle gets a Refusal.

## 11. Security Considerations

- A compromised Signer key can answer with any address, and for a system
  routing payments that is the whole risk. Removing it takes one owner
  transaction on each chain whose resolver trusts it. The callback checks the
  Signer when it runs, so the answers it signed stop verifying from that
  block on.
- The current deployment does not meet REQ-ENS-KEY-01. One key, the KMS
  key the contracts' deploy workflow signs with, deploys the Handle
  Resolver, owns it, and owns the Parent Name in the ENS registry. Whoever
  can use that key can trust a Signer of their own and point the URL list at
  their own endpoint, with no Signer key involved.
- One Signer may serve Handle Resolvers on several chains. The digest covers
  no chain ID, but it covers the resolver's address, and REQ-ENS-KEY-02 keeps
  those apart, so an answer verifies only at the resolver it was signed for.
- The Gateway applies the handle rules it was built with to every chain. A
  chain whose `IdentityRegistry` admits a platform's handles under wider
  rules than those can hold a binding the Gateway's rules refuse; that
  binding's name gets a Signed Null although the binding exists. A change to
  a platform's rules on any indexed chain needs a Gateway built with the
  same rules before such bindings resolve.
- The Gateway does not implement REQ-ENS-LABEL-05's SHOULD. It reads
  `alice._at.gmail.com.google.handles.link` as `alice@gmail.com`, so every
  Gmail handle has a second name that resolves to the same binding, and
  that form takes a local part outside the Gmail alphabet of
  REQ-ENS-LABEL-03, such as one with `-`, on to the handle rules and the
  lookup. It likewise reads an X or Workspace label with `--` at the third
  and fourth characters, which no ENSIP-15 client sends. Each such name
  resolves to the binding of the handle the Gateway reads from it.
- A user has no onchain claim to the name. It resolves while the Gateway
  runs and the Parent Name points at the Handle Resolver. The binding in the
  `IdentityRegistry` survives either, and is readable without them.
- Nothing orders bindings across chains. A handle the platform recycled can
  be bound to different holders on different chains, and one name then
  resolves to different people depending on the chain asked. Each answer is
  correct for its chain. A Gateway that answered only for the freshest chain
  would be deciding rather than reporting; this specification does not.
- A binding on a chain means funds sent to the name on that chain reach its
  holder. A Workspace name publishes the employer's domain.
- The chain a transaction is finally sent on is the client's choice. A Chain
  Label cannot make a wallet send on that chain; it makes the Gateway
  withhold the address when the Coin Type disagrees.

## 12. Not specified

- Gateway policy when chains disagree about one handle.
- Whether an application shows a user the name derived under §6.
- Whether a Workspace name is offered by default, given that it discloses an
  employer.
- The deepest name clients resolve. ENSIP-10 is depth-agnostic; a Gmail name
  with a Chain Label has six labels.

## 13. Provenance

| Requirement | Source |
|---|---|
| REQ-ENS-RES-01 to RES-04 | `libid-contracts` `solidity/contracts/ens/HandleResolver.sol` |
| REQ-ENS-RES-05 | `libid-contracts` `scripts/setup-ens-resolver.sh` refuses a URL without both placeholders; the contract does not check |
| REQ-ENS-NAME-01 to NAME-04 | `usernames-indexer` `crates/usernames-core/src/ens.rs`; its `ChainName::parse` accepts a Chain Label longer than 63 bytes or with `--` at the third and fourth characters, which REQ-ENS-NAME-01 refuses |
| REQ-ENS-LABEL-01 to LABEL-04 | `libID` `ts/packages/ens` (`@libid/ens`, libID PR #109, unmerged): the forward transform for the Parent Name `handles.link` only; it does not refuse a Workspace label with `--` at the third and fourth characters |
| REQ-ENS-LABEL-05 | `usernames-indexer` `crates/usernames-core/src/ens.rs`, `crates/usernames-core/src/nodes.rs`: the MUST; the SHOULD is not implemented (§11) |
| REQ-ENS-GW-01 to GW-11 | `usernames-indexer` `bin/usernames-api/src/ens.rs`, `crates/usernames-core/src/ens.rs`; the TTL ceiling of REQ-ENS-GW-08 in `bin/usernames-api/src/lib.rs` |
| REQ-ENS-KEY-01 | not met by the current deployment (§11) |

## 14. References

Normative:

- [ENSIP-10] Wildcard Resolution (<https://docs.ens.domains/ensip/10/>).
- [ENSIP-11] EVM Chain Address Resolution (<https://docs.ens.domains/ensip/11/>).
- [ENSIP-15] Name Normalization (<https://docs.ens.domains/ensip/15/>).
- [ERC-3668] CCIP Read (<https://eips.ethereum.org/EIPS/eip-3668>).
- [EIP-191] Signed Data Standard (<https://eips.ethereum.org/EIPS/eip-191>).
- [RFC1035] Domain Names (<https://www.rfc-editor.org/rfc/rfc1035>).
- [RFC2119] Key words for use in RFCs to Indicate Requirement Levels
  (<https://www.rfc-editor.org/rfc/rfc2119>), as clarified by [RFC8174]
  (<https://www.rfc-editor.org/rfc/rfc8174>).

Informative:

- [ENSIP-21] Batch Gateway Offchain Lookup Protocol (<https://docs.ens.domains/ensip/21/>).
- [ENSIP-22] ENS Universal Resolver (<https://docs.ens.domains/ensip/22/>).
- [DNS Registrar] <https://docs.ens.domains/registry/dns/>.
