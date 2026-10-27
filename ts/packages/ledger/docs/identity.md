# `@libid/ledger`

The `LedgerId` contract that application code passes to ceremonies: the notary
that serves a ledger. The package defines only this interface.
It contains no ledger definitions, RPC client, transaction handling, or ceremony
dependency.

## API

```ts
export interface LedgerId {
  notaryAddress(): string // canonical HTTPS origin; HTTP on localhost/127.0.0.1 for development
}
```

`notaryAddress()` returns a canonical HTTPS origin with no credentials, path,
query, or fragment. The address selects a network destination, not the signing
keys a ledger verifier trusts. For local development only, it may return a
canonical HTTP origin on exactly `localhost` or `127.0.0.1`; ceremony then derives
WS on the same authority. No other HTTP hosts are accepted.

Tests and local development can supply a fixture that selects a local notary;
no environment override is needed:

```ts
const localLedger: LedgerId = {
  notaryAddress: () => 'http://localhost:4687',
}
```

## Implementing a ledger

A definition and its checks live beside its implementation; no public
registration API or class hierarchy is required. Test its notary address against
the ledger's deployment.
