# `@libid/ledger`

The `LedgerId` contract that application code passes to ceremonies, and the
catalog of supported ledgers. The package owns each ledger's chain identifier,
Chain Profile hash, and notary address. This entry point contains no RPC client,
transaction handling, or ceremony dependency; chain access is the separate
`@libid/ledger/client` entry point.

## API

```ts
export interface LedgerId {
  readonly chain: `${string}:${string}` // CAIP-2 chain identifier
  hash(): Uint8Array // exact 32-byte Chain Profile identifier
  notaryAddress(): string // canonical HTTPS origin; HTTP on localhost/127.0.0.1 for development
}
```

`chain` is the ledger's CAIP-2 identifier, such as `eip155:3735928814`.
Synthetic test ledgers use the `test` namespace.

`hash()` returns the ledger's canonical Chain Profile encoding, the identifier
that ledger's verifier uses. Mutating the returned bytes must not change later
results. The notary address is not part of this hash. For `eip155`, the encoding
is `keccak256(abi.encode(uint256 chainId))`, matching `block.chainid` in the
ceremony verifier contracts.

`notaryAddress()` returns a canonical HTTPS origin with no credentials, path,
query, or fragment. The address selects a network destination, not the signing
keys a ledger verifier trusts. For local development only, it may return a
canonical HTTP origin on exactly `localhost` or `127.0.0.1`; ceremony then derives
WS on the same authority. No other HTTP hosts are accepted.

Tests and local development can supply a fixture that keeps a target ledger's
hash while selecting a local notary; no environment override is needed:

```ts
const localLedger: LedgerId = {
  ...targetLedger,
  notaryAddress: () => 'http://localhost:4687',
}
```

## Implementing a ledger

Ledger definitions live in the catalog and are built with `defineLedger`, the
shared implementation for each namespace; no public registration API or class
hierarchy is required. Test each definition's notary address and exact 32-byte
Chain Profile hash against the ledger's vectors, including the value its deployed
verifier reports from `CeremonyProofVerifier.chainId()`. Distinct networks must
keep distinct identities.
