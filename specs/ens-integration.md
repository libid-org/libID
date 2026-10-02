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

Parent Name: `handles.link`, a DNS name imported into the ENS registry on the
   ENS chain through the ENS DNS registrar.

ENS Chain: Ethereum mainnet for a production deployment; a test deployment
   uses an Ethereum test network that hosts the ENS registry.

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

Coin Type: The ENSIP-11 coin type a client asks with. `60` is Ethereum
   mainnet; an EVM chain `c` is `0x80000000 | c`.

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
  Whoever controls the Parent Name's DNS registration and DNSSEC keys
  controls the Parent Name in ENS: a later valid DNSSEC proof overwrites its
  owner.

## 4. Security properties

- SP-ENS-01:
  The Handle Resolver returns an answer only when a current Signer signed
  that exact answer, for that exact query, for that resolver, and the answer
  has not expired. An answer cannot be replayed for another name, another
  record, another resolver, or after its deadline. Depends on ASM-ENS-04.
- SP-ENS-02:
  A signed address is the holder the Indexed Store records for the handle on
  the one chain the Coin Type names. Depends on ASM-ENS-03.
- SP-ENS-03:
  The Gateway never signs absence it does not know: a chain it does not
  index, a Coin Type two indexed chains share, and an index too far behind
  each get a Refusal, never a Signed Null.
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
name = handleLabels "." platformLabel [ "." chainLabel ] ".handles.link"
```

```text
alice.x.handles.link                  short form
alice.x.base.handles.link             with a Chain Label
alice.smith.google.handles.link       Gmail
alice._at.company.com.google.handles.link
                                      Google Workspace
```

- REQ-ENS-NAME-01 (upholds SP-ENS-04):
  Platform Labels and Chain Labels MUST be disjoint sets. A Chain Label MUST
  match `[a-z0-9-]+`. Necessity: the parse below tells the two apart only by
  membership.
- REQ-ENS-NAME-02 (upholds SP-ENS-04):
  A name MUST be parsed right to left. After `handles.link`, the last label
  is the Platform Label if it is one; otherwise it is the Chain Label and the
  label before it is the Platform Label. Every remaining label is a Handle
  Label. Necessity: a Gmail or Workspace handle contributes a variable number
  of labels, so only the right end has fixed positions.
- REQ-ENS-NAME-03 (upholds SP-ENS-05):
  A name with a Chain Label MUST be answered only when the Coin Type names
  the chain that label names. A name without one is answered for the chain
  the Coin Type names.
- REQ-ENS-NAME-04:
  A name MUST be DNS wire format with every label 1 to 63 bytes. A label
  containing an uppercase letter or a byte at or below `0x20` is not a name
  any handle produces.

## 6. Handle labels

The transform takes the handle `HandleNormalizer` produced under the
platform's rules, never raw input. It returns Handle Labels or refuses. A
refused handle has no name; its binding stays readable through the
`IdentityRegistry` and by address.

ENSIP-15 accepts every label below except where a rule refuses, and two of
its rules shape them: `_` may appear only at the start of a label, and a
label's third and fourth characters must not both be `-`.

- REQ-ENS-LABEL-01 (X):
  The Handle Labels of an X handle are one label: the handle with every `_`
  replaced by `-`. The transform MUST refuse a handle whose third and fourth
  characters are both `_`. Necessity: X issues no `-`, so the substitution
  reverses exactly; the refusal is ENSIP-15's `/^..--/` rule and nothing
  more.
- REQ-ENS-LABEL-02 (GitHub):
  The Handle Labels of a GitHub handle are one label: the handle unchanged.
  Necessity: GitHub's rules admit neither `_` nor a doubled `-`, so no
  ENSIP-15 rule can fire.
- REQ-ENS-LABEL-03 (Gmail):
  For a Google handle whose domain is `gmail.com`, the Handle Labels are the
  local part split at every `.`. The transform MUST refuse a local part not
  matching `^[a-z0-9]+(\.[a-z0-9]+)*$`. Necessity: Gmail issues only that
  alphabet; a mapping for characters no account can hold would be untested
  code on a payment path.
- REQ-ENS-LABEL-04 (Google Workspace):
  For any other Google handle, the Handle Labels are the local part split at
  `.`, then `_at`, then the domain split at `.`. Every label other than
  `_at` MUST be non-empty and match `[a-z0-9-]+`; the transform MUST refuse
  otherwise. Necessity: joining local part and domain with dots alone is
  ambiguous (`a.b@c.com`, `a@b.c.com`); `_at` cannot collide with a Handle
  Label, because a leading `_` is the only one ENSIP-15 admits and no other
  Handle Label holds one.
- REQ-ENS-LABEL-05 (upholds SP-ENS-04):
  The Gateway MUST read Handle Labels by the exact inverse of
  REQ-ENS-LABEL-01 to -04, run the result through the chain's handle rules,
  and answer a Signed Null when either step fails. It SHOULD answer a Signed
  Null for labels outside the transform's image, such as an X label with
  `--` at the third and fourth characters, or `_at` followed by `gmail.com`.
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

  where `resolver` is the Handle Resolver's 20-byte address. It reverts
  `SignatureExpired`, `DeadlineTooFar`, or `UntrustedSigner` otherwise.
  Necessity: the resolver address binds the answer to one resolver, the
  request hash to one query, the result hash to one answer, and the ceiling
  stops a leaked answer living indefinitely.
- REQ-ENS-RES-04:
  Only the owner MAY replace the URL list or add or remove a Signer.
  Ownership MUST transfer in two steps and MUST NOT be renounceable. The
  Handle Resolver is not upgradeable; it is replaced by setting another
  resolver on the Parent Name.

## 8. Gateway

### 8.1 Requests

- REQ-ENS-GW-01:
  The Gateway MUST serve `GET {base}/{sender}/{data}`, where `{data}` is the
  hex `callData` of REQ-ENS-RES-02, with or without `0x` and a `.json`
  suffix. A `{data}` that is not hex, not a `resolve` call, or not decodable
  MUST get HTTP 400.
- REQ-ENS-GW-02:
  The Gateway MUST answer HTTP 400 for a name outside `handles.link`, a name
  violating REQ-ENS-NAME-04's wire rules, and a record call whose node is not
  the namehash of the name. Necessity: these are malformed queries, not
  names; and a node that differs from the name means the client and the
  Gateway normalized differently, which must not be signed.

### 8.2 Choosing the chain

- REQ-ENS-GW-03 (upholds SP-ENS-02, SP-ENS-03):
  The Gateway MUST match the Coin Type forward against the chain IDs in the
  Indexed Store: chain `c` matches `0x80000000 | c`, and chain 1 also
  matches `60`. It MUST NOT decode a Coin Type into a chain ID. Exactly one
  match selects that chain. Necessity: `0x80000000 | c` is not injective for
  `c >= 2^31`, so decoding would answer for a different chain.
- REQ-ENS-GW-04 (upholds SP-ENS-03):
  With no match, the Gateway MUST return a Refusal (HTTP 503) when the Coin
  Type names an EVM chain (`60`, or bit 31 set), and a Signed Null otherwise.
  With two or more matches it MUST return a Refusal (HTTP 503). Necessity:
  the resolver has one URL list for every query, and ERC-3668 has the client
  walk it until one succeeds. A Signed Null is a success that ends the walk,
  so signing absence for a chain this Gateway does not hold would deny a
  binding a later Gateway in the list could serve. No libID binding is ever
  a non-EVM address, so that absence is known.
- REQ-ENS-GW-05 (upholds SP-ENS-05):
  Once a chain is selected, a name the Gateway cannot parse, a Handle Label
  outside REQ-ENS-LABEL-05, and a Chain Label not naming the selected chain
  MUST each get a Signed Null.
- REQ-ENS-GW-06 (upholds SP-ENS-03):
  Before answering from a chain, the Gateway MUST return a Refusal (HTTP 503)
  when that chain's index is more than the deployment's maximum lag behind,
  or its indexer report has expired or is unknown. Necessity: a stale index
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
  the request, and with `expires` at most 3300 seconds after signing. It MAY
  refuse a `{sender}` that is not that address with HTTP 400, comparing
  addresses case-insensitively. Necessity: on the Universal Resolver's
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
  A Signer MUST NOT be trusted by Handle Resolvers at one address on two
  chains. Necessity: the digest does not cover a chain ID, so such an answer
  verifies on both.

## 10. Conformance

- TEST-ENS-01 (exercises REQ-ENS-LABEL-01 to -05):
  Forward and inverse vectors for each platform round-trip; `a__b` maps to
  `a--b` and `ab__cd` is refused; a Gmail local part with `+`, `-` or `_` is
  refused; `a.b@c.com` and `a@b.c.com` give different names.
- TEST-ENS-02 (exercises REQ-ENS-RES-03, REQ-ENS-GW-08):
  One digest vector reproduces in the Handle Resolver and the Gateway; the
  callback rejects an expired answer, one past the ceiling, an untrusted
  Signer, and an answer signed for another resolver address.
- TEST-ENS-03 (exercises REQ-ENS-GW-03 to -06):
  An unindexed EVM Coin Type, coin type 60 without chain 1 indexed, two
  chains sharing one Coin Type, and a stale index each get a Refusal; a
  non-EVM Coin Type, an unknown Handle Label, and a mismatched Chain Label
  each get a Signed Null.
- TEST-ENS-04 (exercises REQ-ENS-GW-07, REQ-ENS-GW-09, REQ-ENS-GW-10):
  Both `addr` shapes answer a bound and an unbound handle; a `text` call gets
  the signed empty result; a 200 and a Refusal both carry
  `Access-Control-Allow-Origin: *`.
- TEST-ENS-05 (exercises SP-ENS-01, SP-ENS-02 end to end):
  A name resolves through the ENS Universal Resolver on the ENS Chain, with
  the batch gateway played by the test. The same name fails with CCIP-Read
  disabled on the client, which shows the answer came offchain.

## 11. Security Considerations

- A compromised Signer key can answer with any address, and for a system
  routing payments that is the whole risk. Removing the Signer is one owner
  transaction; answers already signed stay valid until they expire, at most
  an hour.
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
| REQ-ENS-NAME-01 to NAME-04, REQ-ENS-LABEL-05 | `usernames-indexer` `crates/usernames-core/src/ens.rs` |
| REQ-ENS-GW-01 to GW-10 | `usernames-indexer` `bin/usernames-api/src/ens.rs`, `crates/usernames-core/src/ens.rs` |
| REQ-ENS-LABEL-01 to LABEL-04 | no implementation yet |

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
