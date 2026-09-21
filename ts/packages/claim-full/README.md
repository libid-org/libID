# @libid/claim-full

[@libid/claim](https://www.npmjs.com/package/@libid/claim) plus batteries:
the npm tarball carries every static asset the claim flows load at runtime,
so an integration needs no staging scripts and no curl.

```sh
npm install @libid/claim @libid/claim-full
npx libid-claim-assets public        # copy the asset tree into your static root
```

That is the whole setup. `public/` (vite, next.js, any static server) now
serves exactly the layout `@libid/claim`'s default same-origin URLs expect:

| staged path | consumer |
|---|---|
| `/tlsn_wasm.js`, `/tlsn_wasm_bg.wasm`, `/spawn.js` | X flow's MPC-TLS prover (libid-org/notary release) |
| `/circuits/x_token.json` | X token circuit (libid-org/libID-circuits release) |
| `/circuits/jwt_email.json` | Google OIDC circuit (libid-org/libID-circuits release) |
| `/circuits/manifest.json` | the circuits release manifest (provenance) |
| `/wasm/acvm_js_bg.wasm`, `/wasm/noirc_abi_wasm_bg.wasm` | noir witness generation (@noir-lang pins) |

The GitHub flow needs none of these — its proof comes from the
libid-server-rs.

Programmatic staging (build scripts, postinstall hooks):

```js
import { copyAssets } from '@libid/claim-full' // node-only entry
copyAssets('public')
```

## Per-call URL overrides via subpath imports

Every asset is also exported under `./assets/*`, for passing explicit URLs
to `@libid/claim` instead of (or on top of) staging:

- **vite** — both forms work and emit the asset into the build:
  ```ts
  import circuitUrl from '@libid/claim-full/assets/circuits/jwt_email.json?url'
  const wasm = new URL('@libid/claim-full/assets/tlsn_wasm_bg.wasm', import.meta.url).href
  ```
- **next.js** — `new URL('@libid/claim-full/assets/…', import.meta.url)`
  works under BOTH bundlers (verified with next 16: turbopack and
  `--webpack` each emit the file under `/_next/static/media/`).

Staging into `public/` remains the recommended path: `@libid/claim`'s
default asset URLs are same-origin absolute paths fetched at runtime
(including from inside workers), so overrides only cover call sites that
accept a URL (`circuitUrl`, the prover wasm URLs) — the tlsn bundle's
spawn.js sibling, for instance, must still be served from the origin.

## Provenance and the toolchain tie

`package.json`'s `libid` field pins the release tags the bundle was staged
from (`notaryRelease`, `circuitsRelease`). The assets are not in git:
`scripts/fetch-assets.mjs` fetches them at build/publish time, verifying
each circuits tarball and file against the release manifest's sha256s.

The build fails if `@libid/claim`'s `@aztec/bb.js` / `@noir-lang/noir_js`
pins differ from the toolchain recorded in the circuits release manifest,
and the test suite derives both circuits' verification keys with the pinned
bb.js and asserts their sha256s equal the manifest's — the deployed
on-chain verifiers are generated from those exact vk bytes. Bump the prover
pins and the circuits release together, or not at all.
