# @libid/ledger

Shared `LedgerId` contract and decoder for application and browser-document code.
See the [identity contract](docs/identity.md), extracted from architecture PR #13
at `b078fa33039a73c194ade24d266c69752e911fcd`.

**No real ledger definitions are implemented yet.** The production
`LedgerId.decode(value)` rejects every identifier. Adding a supported ledger means
adding its canonical decoder, immutable value, classification and matching Chain
Profile hash vectors here; ceremony needs no chain-specific changes.

## Shared test fixture

```ts
import { LedgerId } from '@libid/ledger/testing'

const ledger = LedgerId.decode('test:testnet')
const restored = LedgerId.decode(ledger.encode())
```

The testing entrypoint recognizes only `test:mainnet` and `test:testnet`. These
synthetic identities return dummy 32-byte hashes; they are not real Chain Profiles
and establish no ledger conformance. The production entrypoint never imports them.
Tests may alias `@libid/ledger` to this entrypoint on both sides of a message
boundary. Ceremony's fixture distribution is restricted to local qualification
output; never deploy it as a supported-ledger distribution.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build`,
`pnpm --filter @libid/ledger typecheck`, and `pnpm --filter @libid/ledger test`.
