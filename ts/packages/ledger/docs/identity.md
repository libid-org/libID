# Ledger identity contract

Shared ledger identity for application and browser-document code. The package
owns canonical ledger encoding/decoding, the Chain Profile hash, and network
classification. It contains no RPC client, transaction handling, notary
addresses, or ceremony dependency.

## API

```ts
export interface LedgerId {
  encode(): string
  hash(): Uint8Array // exact 32-byte Chain Profile identifier
  isTestnet(): boolean
}

export declare const LedgerId: {
  decode(value: unknown): LedgerId
}
```

`encode()` returns the package's canonical, self-identifying ledger string.
Its family identifies the decoder; the native ledger identifier identifies the
network. `LedgerId.decode` validates that encoding and returns the corresponding
immutable ledger value, rejecting malformed, noncanonical, or unsupported
identifiers. Code-owned ledger definitions determine `isTestnet()`; the wire
value contains no independently supplied testnet flag or precomputed hash.

`hash()` uses the ledger's canonical Chain Profile encoding, not a hash of the
transport string or its JSON representation. Its result matches the identifier
used by that ledger's verifier. Returned bytes cannot mutate the ledger value.

```ts
const encoded = ledgerId.encode() // send this string across the browser boundary
const restored = LedgerId.decode(encoded)
restored.isTestnet()
restored.hash()
```

The package owns both sides of this roundtrip. Browser structured cloning does
not preserve ledger methods; callers send the encoding and explicitly decode
it after message validation. No generic transport needs to know this type.

Concrete ledger definitions and their encoding/hash vectors belong beside
their implementation. Sharing an implementation within a ledger family or
using a class per ledger is an internal choice; neither a public registration
API nor a class hierarchy is required. Notary selection remains outside this
package and may use `isTestnet()` without changing ledger encoding or hashing.

## Checks

For every supported ledger, test canonical encode/decode roundtrips, unchanged
classification and hash across the roundtrip, and the matching Chain Profile
hash vector. Distinct supported networks must retain distinct identities.
Reject unknown families/networks and noncanonical encodings. Mutating returned
hash bytes must not change later results.
