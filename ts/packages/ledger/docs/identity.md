# `@libid/ledger`

Ledger identity and notary routing for application code. The package owns the
Chain Profile hash and each ledger's notary address. It contains no RPC client,
transaction handling, or ceremony dependency.

## API

```ts
export interface LedgerId {
  hash(): Uint8Array // exact 32-byte Chain Profile identifier
  notaryAddress(): string // canonical HTTPS origin
}
```

`hash()` uses the ledger's canonical Chain Profile encoding and matches the
identifier used by that ledger's verifier. Returned bytes cannot mutate the
ledger value. The notary address is not part of this hash.

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
  hash: () => targetLedger.hash(),
  notaryAddress: () => 'https://localhost:8443',
}
```

Concrete ledger definitions and their hash/address checks belong beside
their implementation. Sharing an implementation within a ledger family or
using a class per ledger is an internal choice; neither a public registration
API nor a class hierarchy is required.

## Checks

For every supported ledger, test its notary address and exact 32-byte Chain
Profile hash against the ledger's vectors. Distinct supported networks must
retain distinct identities. A fixture changing only the notary address must
retain the target ledger hash. Mutating returned hash bytes must not change
later results.
