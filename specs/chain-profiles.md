# Chain profiles

Part of the [libID protocol specification](libid.md).

## 1. Scope

This document is the normative owner of the Chain Profiles libID publishes.
A Chain Profile fixes, for one family of Consumer Chains, the four things
[common](ceremony-common.md) REQ-COMMON-01C, REQ-COMMON-01D and
REQ-COMMON-01F leave to it: the Chain ID, how the chain authenticates the
Transaction Author, how it supplies Block Time, and how Authorized
Transaction Data is encoded.

A Chain Profile defines no ceremony construction. It says what the values a
ceremony already commits are on one chain, so that a Canonical Runtime
composing a ceremony for a destination and the Platform Verifier deployed
there commit the same bytes. Selecting one is destination selection, not
proof authority.

## 2. Terminology

EVM Consumer Chain: A Consumer Chain whose execution environment reports an
   EIP-155 chain identifier, a block timestamp, and an immediate caller to
   the Consumer.

Chain Identifier: The value a Consumer Chain names itself by, before hashing.
   The Chain ID of common §2 is the keccak256 of the exact bytes this profile
   fixes for it.

## 3. The EVM Chain Profile

### 3.1 Chain ID

```text
chainIdentifier = the EIP-155 chain identifier
canonicalBytes  = U256BE(chainIdentifier)          // exactly 32 bytes
chainId         = keccak256(canonicalBytes)
```

- REQ-EVM-01 (upholds SP-BIND-01, SP-REPLAY-01):
  An EVM Consumer Chain's canonical Chain Identifier is its EIP-155 chain
  identifier, and the exact bytes it contributes are that value's unsigned
  256-bit big-endian encoding. The Chain ID is the keccak256 of exactly those
  32 bytes. Necessity: EIP-155 identifiers are already unique across the
  chains that honor them, and a fixed width leaves no encoding a second
  implementation could choose differently.
- REQ-EVM-01A (upholds SP-BIND-01):
  The Platform Verifier MUST take the Chain Identifier from its own execution
  environment, and its digest recomputation MUST accept none as an argument.
  Necessity: REQ-COMMON-01C, restated where it is implemented — a
  recomputation that takes the identifier can be handed another chain's.
- REQ-EVM-01B (upholds SP-BIND-01):
  The Proof Verifier MUST expose its Chain ID for reading. Necessity:
  REQ-COMMON-01C has the composition supply the Chain ID to the Canonical
  Runtime, and this is where it can read the exact 32 bytes the destination
  will recompute against, instead of deriving them a second time from a
  chain identifier it believes the destination has.
- REQ-EVM-01C (upholds SP-REPLAY-01):
  A Chain Profile other than this one MUST NOT derive its Chain ID as the
  keccak256 of a bare unsigned 256-bit big-endian integer. Necessity:
  REQ-COMMON-01C supplies no chain-identifier registry and leaves separation
  to profile authors; this profile takes the unnamespaced integer preimage,
  and a second profile taking it too would give two Consumer Chains one Chain
  ID and forfeit replay separation between them.

Conformance vectors:

```text
chainIdentifier = 1            chainId = 0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6
chainIdentifier = 8453         chainId = 0x3e30a4f0e31d8ec3b8e98957bc7fedf7f6fb560612e2775c74a396200aa3155b
chainIdentifier = 11155111     chainId = 0x4679aa19497ce87eb9ffd768757c9397680da8c7963db8096790ee03622ae968
```

### 3.2 Transaction Author

- REQ-EVM-02 (upholds SP-BIND-01):
  The Transaction Author is the account the execution environment reports as
  the Consumer's immediate caller. The Consumer MUST authenticate it from
  that report alone.
- REQ-EVM-02A (upholds SP-BIND-01):
  The Consumer MUST NOT read the Transaction Author from the account that
  originated and pays for the transaction. Necessity: that account is the
  Transaction Submitter of REQ-COMMON-04, which this profile does not
  authenticate as the same principal — anything it reaches through an
  intermediate would authorize under the submitter's identity rather than the
  caller's.

### 3.3 Block Time

- REQ-EVM-03 (upholds SP-FRESH-01):
  Block Time is the block timestamp the execution environment reports, in
  whole seconds, bounded by an unsigned 64-bit integer. The Consumer MUST
  read it from that environment and never from the Submission or the
  Authorized Transaction Data.

### 3.4 Authorized Transaction Data

- REQ-EVM-04 (upholds SP-BIND-01):
  Authorized Transaction Data is the EVM ABI encoding of the transaction
  kind's argument tuple. The Consumer's protocol fixes that tuple for each
  transaction kind it accepts, and the Consumer MUST decode with a strict
  decoder that rejects trailing bytes and any other argument shape
  (REQ-COMMON-01F).

## 4. Conformance tests

- TEST-EVM-01 (exercises REQ-EVM-01, REQ-EVM-01A, REQ-EVM-01B):
  The §3.1 vectors reproduce; the digest recomputation takes no Chain
  Identifier argument; and the Chain ID the Proof Verifier exposes equals the
  one that recomputation commits.
- TEST-EVM-02 (exercises REQ-EVM-02, REQ-EVM-02A):
  A Consumer reached through an intermediate account authorizes on that
  account and rejects a call that only the originating account's identity
  would satisfy.
- TEST-EVM-03 (exercises REQ-EVM-04):
  Authorized Transaction Data carrying trailing bytes past its argument tuple
  is rejected.
