# `@libid/ledger`

The `LedgerId` contract that application code passes to ceremonies: a ledger's
identity and the notary that serves it. The package defines only this interface.
It contains no ledger definitions, RPC client, transaction handling, or ceremony
dependency.

## API

```ts
export interface LedgerId {
  hash(): Uint8Array // exact 32-byte Chain Profile identifier
  notaryAddress(): string // canonical HTTPS origin; HTTP on localhost/127.0.0.1 for development
}
```

`hash()` returns the ledger's canonical Chain Profile encoding, the identifier
that ledger's verifier uses. Mutating the returned bytes must not change later
results. The notary address is not part of this hash.

`notaryAddress()` returns a canonical HTTPS origin with no credentials, path,
query, or fragment. The address selects a network destination, not the signing
keys a ledger verifier trusts. For local development only, it may return a
canonical HTTP origin on exactly `localhost` or `127.0.0.1`; ceremony then derives
WS on the same authority. No other HTTP hosts are accepted.

Tests and local development can supply a fixture that keeps a target ledger's
hash while selecting a local notary; no environment override is needed:

```ts
const localLedger: LedgerId = {
  hash: () => targetLedger.hash(),
  notaryAddress: () => 'http://localhost:4687',
}
```

## Implementing a ledger

A definition and its checks live beside its implementation; no public
registration API or class hierarchy is required. Test its notary address and
exact 32-byte Chain Profile hash against the ledger's vectors. Distinct networks
must keep distinct identities.
