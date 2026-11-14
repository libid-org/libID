---
title: Chain profiles
description: libID specification for how consumer chains authenticate transaction authors, supply block time, and encode authorized transaction data.
---

# Chain profiles

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document holds one profile per family of Consumer Chains. [Common](ceremony-common.md)
§2 defines what a Chain Profile is, and REQ-COMMON-01D and REQ-COMMON-01F say
what one owes. §2 below is what holds across every
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
| how Authorized Transaction Data is encoded | REQ-COMMON-01F |

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
  decoder that rejects trailing bytes and any other argument shape
  (REQ-COMMON-01F).

- REQ-CHAIN-07A (upholds SP-BIND-01):
  Where it commits a chain identifier under REQ-COMMON-01C, the Consumer
  MUST commit the EIP-155 chain identifier and compare it with the one its
  execution environment reports.

## 4. Conformance tests

- TEST-CHAIN-01 (exercises REQ-CHAIN-01):
  Every profile in this document answers all three duties of §2.
  Verification: inspection.
- TEST-CHAIN-04 (exercises REQ-CHAIN-05, REQ-CHAIN-05A):
  A Consumer reached through an intermediate account authorizes on that
  account and rejects a call that only the originating account's identity
  would satisfy.
- TEST-CHAIN-05 (exercises REQ-CHAIN-07):
  Authorized Transaction Data carrying trailing bytes past its argument tuple
  is rejected.
- TEST-CHAIN-06 (exercises REQ-CHAIN-07A):
  A Consumer that commits a chain identifier accepts Authorized Transaction
  Data naming the EIP-155 chain identifier its execution environment reports
  and rejects data naming another.
