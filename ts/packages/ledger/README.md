# @libid/ledger

Shared `LedgerId` contract for application code: `hash()` and `notaryAddress()`.
See the [identity contract](docs/identity.md), extracted from architecture PR #13
at `0259e72c184e2be7b78a0ad92188e8722d8d6daf`.

**No real ledger definitions are implemented yet.** Adding one requires its
canonical Chain Profile hash vectors and notary-address checks. Ceremony stays
chain agnostic; Prover has no ledger dependency.

## Shared test fixture

```ts
import { testnet } from '@libid/ledger/testing'

const localLedger = {
  hash: () => testnet.hash(),
  notaryAddress: () => 'https://localhost:4687',
}
```

The testing entrypoint exports `mainnet` and `testnet`, synthetic identities with
dummy 32-byte hashes. They establish no real ledger conformance. A local fixture
can change the notary address without changing its hash. Fixtures belong to the
application or tests; CCDP uses the same distribution for every ledger.

## Checks

From the TypeScript workspace: `pnpm --filter @libid/ledger build`,
`pnpm --filter @libid/ledger typecheck`, and `pnpm --filter @libid/ledger test`.
