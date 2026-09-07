# Chain profiles

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document holds one profile per family of Consumer Chains. [Common](ceremony-common.md)
§2 defines what a Chain Profile is, and REQ-COMMON-01C, REQ-COMMON-01D and
REQ-COMMON-01F say what one owes. §2 below is what holds across every
profile; each later section answers those duties for one family. EVM chains
are §3; a family that identifies, authenticates, or encodes differently —
Solana, Move — takes a section of its own here rather than a document of its
own.

A profile defines no ceremony construction. It says what the values a
ceremony already commits are on one chain, so that a Canonical Runtime
composing for a destination and the Platform Verifier deployed there commit
the same bytes. Selecting one is destination selection, not proof authority.

## 2. What every profile fixes

| duty | required by |
|---|---|
| the canonical Chain Identifier, and the exact bytes it contributes | REQ-COMMON-01C |
| how the chain authenticates the Transaction Author | REQ-COMMON-01D |
| how the chain supplies Block Time | REQ-COMMON-01D |
| how Authorized Transaction Data is encoded | REQ-COMMON-01F |

- REQ-CHAIN-01 (upholds SP-BIND-01):
  A Chain Profile MUST answer all four duties for exactly one family of
  Consumer Chains, and MUST leave none of them to an implementation.
  Necessity: the Canonical Runtime and the Platform Verifier derive these
  independently, so an answer left open is two answers, and they disagree
  only as a digest the destination rebuilds differently.
- REQ-CHAIN-02 (upholds SP-REPLAY-01):
  A Chain Profile MUST state the preimage shape it claims in §2.1, and MUST
  NOT claim a shape another Chain Profile claims. Necessity: REQ-COMMON-01C
  supplies no chain-identifier registry and leaves separation to profile
  authors; two profiles taking one shape give two Consumer Chains one Chain
  ID, and a digest authorized for either is spendable on both.
- REQ-CHAIN-03 (upholds SP-BIND-01):
  A Chain Profile MUST define one reading by which a composition obtains a
  destination's exact 32-byte Chain ID from that destination. Necessity:
  REQ-COMMON-01C has the composition supply the Chain ID to the Canonical
  Runtime, and a value derived a second time from an identifier the
  composition believes the destination has is a guess that fails only after
  the ceremony completes.

### 2.1 Claimed preimages

| profile | canonical Chain Identifier | canonical bytes |
|---|---|---|
| EVM (§3) | the EIP-155 chain identifier | `U256BE`, exactly 32 bytes |

Each profile adds its own row. A shape absent from this table is unclaimed.

## 3. The EVM Chain Profile

An EVM Consumer Chain is one whose execution environment reports an EIP-155
chain identifier, a block timestamp, and an immediate caller to the Consumer.

### 3.1 Chain ID

```text
chainIdentifier = the EIP-155 chain identifier
canonicalBytes  = U256BE(chainIdentifier)          // exactly 32 bytes
chainId         = keccak256(canonicalBytes)
```

- REQ-CHAIN-04 (upholds SP-BIND-01, SP-REPLAY-01):
  The canonical Chain Identifier is the EIP-155 chain identifier, and the
  exact bytes it contributes are that value's unsigned 256-bit big-endian
  encoding. The Chain ID is the keccak256 of exactly those 32 bytes.
  Necessity: EIP-155 identifiers are already unique across the chains that
  honor them, and a fixed width leaves no encoding a second implementation
  could choose differently.
- REQ-CHAIN-04A (upholds SP-BIND-01):
  The Platform Verifier MUST take the Chain Identifier from its own execution
  environment, and its digest recomputation MUST accept none as an argument.
  Necessity: REQ-COMMON-01C, restated where it is implemented — a
  recomputation that takes the identifier can be handed another chain's.
- REQ-CHAIN-04B (upholds SP-BIND-01):
  The reading REQ-CHAIN-03 requires is the Proof Verifier, which MUST expose
  its Chain ID. Necessity: it is the one component every Consumer on the
  chain already routes through, so the bytes a composition reads are the
  bytes that will be recomputed against.

Conformance vectors:

```text
chainIdentifier = 1            chainId = 0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6
chainIdentifier = 8453         chainId = 0x3e30a4f0e31d8ec3b8e98957bc7fedf7f6fb560612e2775c74a396200aa3155b
chainIdentifier = 11155111     chainId = 0x4679aa19497ce87eb9ffd768757c9397680da8c7963db8096790ee03622ae968
```

### 3.2 Transaction Author

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

### 3.3 Block Time

- REQ-CHAIN-06 (upholds SP-FRESH-01):
  Block Time is the block timestamp the execution environment reports, in
  whole seconds, bounded by an unsigned 64-bit integer. The Consumer MUST
  read it from that environment and never from the Submission or the
  Authorized Transaction Data.

### 3.4 Authorized Transaction Data

- REQ-CHAIN-07 (upholds SP-BIND-01):
  Authorized Transaction Data is the EVM ABI encoding of the transaction
  kind's argument tuple. The Consumer's protocol fixes that tuple for each
  transaction kind it accepts, and the Consumer MUST decode with a strict
  decoder that rejects trailing bytes and any other argument shape
  (REQ-COMMON-01F).

## 4. Conformance tests

- TEST-CHAIN-01 (exercises REQ-CHAIN-01, REQ-CHAIN-02):
  Every profile in this document answers all four duties of §2, and no two
  claim one preimage shape in §2.1. Verification: inspection.
- TEST-CHAIN-02 (exercises REQ-CHAIN-03, REQ-CHAIN-04, REQ-CHAIN-04B):
  The §3.1 vectors reproduce, and the Chain ID read from the destination
  equals the one its digest recomputation commits.
- TEST-CHAIN-03 (exercises REQ-CHAIN-04A):
  The digest recomputation takes no Chain Identifier argument, and moving the
  chain under an unchanged Submission moves the digest.
- TEST-CHAIN-04 (exercises REQ-CHAIN-05, REQ-CHAIN-05A):
  A Consumer reached through an intermediate account authorizes on that
  account and rejects a call that only the originating account's identity
  would satisfy.
- TEST-CHAIN-05 (exercises REQ-CHAIN-07):
  Authorized Transaction Data carrying trailing bytes past its argument tuple
  is rejected.
