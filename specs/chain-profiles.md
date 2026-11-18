---
title: Chain profiles
description: libID specification for how consumer chains authenticate transaction authors, supply block time, and encode authorized transaction data.
---

# Chain profiles

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document holds one profile per family of Consumer Chains. [Common](ceremony-common.md)
§2 defines what a Chain Profile is, and REQ-COMMON-01D, REQ-COMMON-01F, and
REQ-COMMON-01H say what one owes. §2 below is what holds across every
profile; each later section answers those duties for one family. EVM chains
are §3; a family that authenticates, keeps time, or encodes differently —
Solana, Move — takes a section of its own here rather than a document of its
own.

A profile defines no ceremony construction. It says how a Consumer on one chain
authenticates its caller, reads its clock, and decodes the Authorized
Transaction Data a ceremony committed.

## 2. What every profile fixes

| duty | required by |
|---|---|
| how the chain authenticates the Transaction Author | REQ-COMMON-01D |
| how the chain supplies Block Time | REQ-COMMON-01D |
| how Authorized Transaction Data is encoded | REQ-COMMON-01F, REQ-COMMON-01H |

- REQ-CHAIN-01 (upholds SP-BIND-01):
  A Chain Profile MUST answer all three duties for exactly one family of
  Consumer Chains, and MUST leave none of them to an implementation.
  Necessity: the Application and the Consumer apply these answers
  independently, so an answer left open is two answers that disagree only
  as a transaction the Consumer rejects.

## 3. The EVM Chain Profile

An EVM Consumer Chain is one whose execution environment reports an EIP-155
chain identifier, a block timestamp, and an immediate caller to the Consumer.

### 3.1 Transaction Author

- REQ-CHAIN-05 (upholds SP-BIND-01):
  The Transaction Author is the account the execution environment reports as
  the Consumer's immediate caller. The Consumer MUST authenticate it from
  that report alone.
- REQ-CHAIN-05A (upholds SP-BIND-01):
  The Consumer MUST NOT read the Transaction Author from the account that
  originated and pays for the transaction. Necessity: that account is the
  Transaction Submitter of REQ-COMMON-04, which this profile does not
  authenticate as the same principal — anything reached through an
  intermediate would authorize under the submitter's identity rather than the
  caller's.

### 3.2 Block Time

- REQ-CHAIN-06 (upholds SP-FRESH-01):
  Block Time is the block timestamp the execution environment reports, in
  whole seconds, bounded by an unsigned 64-bit integer. The Consumer MUST
  read it from that environment and never from the Submission or the
  Authorized Transaction Data.

### 3.3 Authorized Transaction Data

- REQ-CHAIN-07 (upholds SP-BIND-01):
  Authorized Transaction Data is the EVM ABI encoding of the transaction
  kind's argument tuple. The Consumer's protocol fixes that tuple for each
  transaction kind it accepts, and the Consumer MUST decode with a strict
  decoder that accepts only the exact bytes `abi.encode` produces for the
  decoded tuple, rejecting trailing bytes, nonzero padding, any other
  noncanonical encoding, and any other argument shape (REQ-COMMON-01F).

- REQ-CHAIN-07A (upholds SP-BIND-01):
  Where it commits a chain identifier under REQ-COMMON-01C, the Consumer
  MUST commit the EIP-155 chain identifier and compare it with the one its
  execution environment reports.

An Operation List (common REQ-COMMON-01H) is:

```text
struct Operation { bytes32 domain; bytes32 dataHash; }
transactionData = abi.encode(Operation[] entries)
```

The entries are in list order. Each `dataHash` is `keccak256(data)`, where
`data` is the Authorized Transaction Data its entry's domain fixes under
REQ-CHAIN-07. A list of `n` entries is exactly `64 + 64·n` bytes: the word
`0x20`, the word `n`, then each entry's `domain` and `dataHash`.

- REQ-CHAIN-07B (upholds SP-BIND-01):
  The Consumer MUST reject an Operation List unless its first word is
  `0x20`, its length is at least 64 bytes and exceeds 64 by a multiple of
  64, and its second word, the entry count `n`, equals
  `(length − 64) / 64`. Necessity: Solidity's `abi.decode` follows the
  array offset and ignores trailing bytes, so a list with a gap before the
  array or bytes after it decodes to the same entries from other bytes.

Conformance vector for an Operation List, with `platformCeremonyVersion =
1`, `authorizationNonce = 0x5555…5555`, and two entries: a bind entry
(platform §2.1c) for target `0x1111…1111`, and an entry under the test
domain `libid.test.a` whose `data` is the single byte `0xff`. The second
entry stands for another Consumer's entry. `transactionData` is 192 bytes,
shown one 32-byte word per line:

```text
operationDomain = 0x60b329d7366897b03545eb9f63f4a707253258ee2e1cd0ba3a8973aa4959e967  // libid.operations
entry 0 domain  = 0x4d59cd4487de0a5957f8c83addaac7a1238175aa5c29eeea2fbef57a8f5165ac  // libid.bind-identity
entry 0 data    = 0x0000000000000000000000001111111111111111111111111111111111111111  // abi.encode(target)
entry 1 domain  = 0x6b8fd3a153cb2bc403041d7ca7d029d031243d8143d49a248230df9dd07fb723  // libid.test.a
entry 1 data    = 0xff

transactionData =
  w0  0000000000000000000000000000000000000000000000000000000000000020  // offset of the array
  w1  0000000000000000000000000000000000000000000000000000000000000002  // entry count
  w2  4d59cd4487de0a5957f8c83addaac7a1238175aa5c29eeea2fbef57a8f5165ac  // entry 0 domain
  w3  aafae41182fdefb0af836c3b506e127c7f229f33360c66de1139f4b0316f09d8  // keccak256(entry 0 data)
  w4  6b8fd3a153cb2bc403041d7ca7d029d031243d8143d49a248230df9dd07fb723  // entry 1 domain
  w5  8b1a944cf13a9a1c08facb2c9e98623ef3254d2ddb48113885c3e8e97fec8db9  // keccak256(0xff)

authorizationPreimage = operationDomain || 0x0001 || authorizationNonce || 0x000000c0 || transactionData
authorizationDigest   = 0x8eb2153142c324145458f77cd7709e6375ae24b22fa59351549afc522d82c1fb
```

A Consumer owning `libid.bind-identity`, called by the target, rebuilds
`data = abi.encode(target)`, finds its hash in `w3`, and binds the target.
A Consumer owning `libid.test.a`, called with `data = 0xff`, finds its hash
in `w5`. Each of these lists, derived from the vector, is canonical and is
rejected under common REQ-COMMON-01I by the Consumer named:

```text
duplicate entry  w4 = entry 0 domain       // bind Consumer: two candidates under a chain-free domain
nested entry     w4 = operationDomain      // bind Consumer: an entry under libid.operations
no entry         w1 = 0, nothing after w1  // bind Consumer: no candidate
two own domains  w2 = libid.test.b         // Consumer owning libid.test.a and libid.test.b:
                 (0x80b4f95cb6d89708133947b68dcfcfb49b7e1e55f8b96984b151e9c446e91a1f)  // two chain-free candidates
```

Each of these lists decodes under Solidity's `abi.decode` to the vector's
two entries, and the bind Consumer rejects each under REQ-CHAIN-07B:

```text
trailing byte   transactionData || 0x00
gap             w0 = 0x40, one zero word inserted after w0
```

## 4. Conformance tests

- TEST-CHAIN-01 (exercises REQ-CHAIN-01):
  Every profile in this document answers all three duties of §2.
  Verification: inspection.
- TEST-CHAIN-04 (exercises REQ-CHAIN-05, REQ-CHAIN-05A):
  A Consumer reached through an intermediate account authorizes on that
  account and rejects a call that only the originating account's identity
  would satisfy.
- TEST-CHAIN-05 (exercises REQ-CHAIN-07, REQ-CHAIN-07B):
  Authorized Transaction Data carrying trailing bytes past its argument
  tuple is rejected, and so is a bind target word whose high 12 bytes are
  not zero. At a Consumer owning `libid.bind-identity` that accepts
  Operation Lists, each noncanonical list of §3.3 is rejected.
- TEST-CHAIN-06 (exercises REQ-CHAIN-07A):
  A Consumer that commits a chain identifier accepts Authorized Transaction
  Data naming the EIP-155 chain identifier its execution environment reports
  and rejects data naming another.
