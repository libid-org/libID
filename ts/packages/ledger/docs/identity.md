# `@libid/ledger`

Ledger identity and notary routing for application code. The package owns each
ledger's chain identifier, Chain Profile hash, and notary address, and the
catalog of supported ledgers. It contains no RPC client, transaction handling,
or ceremony dependency.

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

`hash()` uses the ledger's canonical Chain Profile encoding and matches the
identifier used by that ledger's verifier. Returned bytes cannot mutate the
ledger value. The notary address is not part of this hash. For `eip155`, the
encoding is `keccak256(abi.encode(uint256 chainId))`, matching `block.chainid`
in the ceremony verifier contracts.

`notaryAddress()` returns a canonical HTTPS origin with no credentials, path,
query, or fragment. Ledger definitions use `https://notary.lib.id` for mainnets
and `https://testnet.notary.lib.id` for testnets. Definitions can share these
constants or choose another address without adding a profile abstraction or
changing the ledger identity. The address selects a network destination, not
the signing keys trusted by a ledger verifier.

Tests and local development can supply a fixture that preserves the target
ledger hash while selecting a local notary; no environment override is needed:

```ts
const localLedger: LedgerId = {
  ...targetLedger,
  notaryAddress: () => 'http://localhost:4687',
}
```

Concrete ledger definitions live in the catalog and are built with
`defineLedger`, the shared implementation for each namespace. Neither a public
registration API nor a class hierarchy is required.

## Checks

For every supported ledger, test its notary address and exact 32-byte Chain
Profile hash against the ledger's vectors, including the value its deployed
verifier reports from `CeremonyProofVerifier.chainId()`. Distinct supported
networks must retain distinct identities. A fixture changing only the notary address must
retain the target ledger hash. Mutating returned hash bytes must not change
later results.

For local development only, `notaryAddress()` may return a canonical HTTP origin
on exactly `localhost` or `127.0.0.1`. Ceremony derives WS on the same authority;
public notaries continue to require HTTPS/WSS. No other HTTP hosts are accepted.
