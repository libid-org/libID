# @libid/ceremony

Browser identity ceremonies over a caller-supplied `@libid/popup` connection.
Google, X and GitHub have closed version-1 implementations. The application owns
window creation, native-anchor launch, wallet operations, submission and what
happens after the result. Ceremony owns its UI and has no styling API.

**This implementation is not launch-qualified.** Real proof generation and
static-distribution checks are separate from real OAuth, matched-notary concurrency
and device qualification. See [QUALIFICATION.md](docs/qualification.md) for evidence,
remaining prerequisites and the complete [requirement index](docs/test-plan.md).

See the [documentation index](docs/README.md) and [source guide](src/README.md) for
module ownership and contracts.

## Application use

```ts
import { createCeremonyClient } from '@libid/ceremony/client'
import { PopupConnection, PopupWindow } from '@libid/popup'

const client = await createCeremonyClient({ oauthBridge: 'https://bridge.example' })

// Inside the application's synchronous click handler. The application supplies
// its own canonical CCDP origin to the popup package's origin allowlist.
const id = crypto.randomUUID()
const target = `ceremony-${id}`
anchor.target = target
const popup = PopupWindow.open(target, 'width=480,height=720')
const connection = PopupConnection.connect(popup, {
  connectionId: id,
  allowedPopupOrigins: ['https://bridge.example', 'https://proofs.example'],
})
const ceremony = client.new(id, {
  connection,
  platformId: 'google',
  chainId,          // 32-byte hash from application composition
  operationDomain, // 32-byte hash from application composition
  transactionData, // exact application-owned transaction bytes
})
anchor.href = ceremony.launchUrl
if (popup.opened) event.preventDefault() // otherwise allow the real anchor
const off = ceremony.onEvent(({ stage, platformStep }) => {
  // Optional advisory application UI; the Prover's own UI remains authoritative.
})
try {
  const result = await ceremony.proveUserIdentity()
  if (result.status === 'accepted') {
    // Submit result.oauthProof through the application's chosen ledger adapter.
    // Accepted means structurally accepted Prover output, not ledger verification.
  }
} finally {
  off()
}
```

Construct the client once per application configuration lifetime. It fetches and
validates public Bridge configuration once; `enabledPlatforms` is a frozen catalog
intersection. Each `new` captures its configuration and copies input bytes. A live
ID cannot be reused by that client. A Ceremony is one-shot. `cancel()` rejects active
work with `AbortError`; OAuth denial resolves `{ status: 'denied' }`. Failure or
connection loss rejects. Start fresh OAuth after loss; there is no recovery API.

Ceremony never closes the supplied connection. Late CCDP messages are decoded and
ignored after settlement, so application continuation can still use the connection.
A new ceremony releases the previous inert handlers before installing its own.
Do not register ceremony's reserved CCDP discriminators on the same connection.

The browser does not verify final proofs or notary signatures. Google nonce parsing
and circuit binding remain; no expected-digest field crosses from Client to Prover.
GitHub token admission checks canonical structure, profile/request bindings and
opening correlation before using the bearer. Identity extraction stays in Prover;
Client only validates the selected proof's structure and wraps retained authorization
inputs. Original attested bytes and signatures are preserved for downstream checks.

## Package layout

| Path | Owner |
|---|---|
| [src/client/](src/client/README.md) | Configuration, frozen construction, one-shot application state |
| [src/ccdp/](src/ccdp/README.md) | Seven message companions and navigation-fragment codecs |
| [src/platforms/](src/platforms/README.md) | Authorization, proof type, asset set and proof pipeline |
| [src/prover/](src/prover/README.md) | Dedicated Noir/bb.js proof worker |
| [src/prover/notarization/](src/prover/notarization/README.md) | Browser TLSNotary sessions, canonical decoding and correlation |
| [src/prefetch/](src/prefetch/README.md) | Root Service Worker, byte caches and pending-fetch joins |
| [src/ccdp/documents/](src/ccdp/documents/README.md) | Callback, Prefetch and Prover page entrypoints |
| `src/ui.ts` | Native, package-owned DOM and progress |
| [build/](build/README.md) | Compiler-owned graph and static response policies |
| [e2e/](e2e/README.md) | Independent HTTPS origins and actual-popup browser checks |

The asset catalog imports only data/type declarations. Execution imports those
same declarations. Compiler output adds actual chunks and nested-worker edges.
Local WASM/circuits/scripts use immutable CCDP paths; CRS remains at the pinned
bb.js native Aztec URLs, including its primary/fallback sequence and Range headers.
Prefetch warms bytes only and acknowledges dispatch before downloads finish.

## Build and serve

From the TypeScript workspace, using Node 22.18+ on 22.x or Node 24+:

```sh
pnpm install --frozen-lockfile
pnpm --filter @libid/popup build
pnpm --filter @libid/ceremony build
LIBID_TLSN_BUNDLE=/absolute/path/to/matched-bundle \
  pnpm --filter @libid/ceremony build:ccdp-artifacts
```

`LIBID_TLSN_BUNDLE` must contain the hash-pinned `tlsn_wasm.js` and
`tlsn_wasm_bg.wasm` pair. It is read, never modified. Circuit downloads are
hash-checked and cached under `.cache/`. `LIBID_NOTARY_ADDRESS` optionally replaces
`https://notary.lib.id` at build time and changes the emitted execution policy.
No browser input can change these locations. `--out-dir` selects another dedicated
output directory inside the checkout. Rebuilding into an existing artifact retains
its previous immutable responses and headers; use that accumulated artifact for
compatible promotion. Preserve it across CI jobs. Do not discard old immutable
resources while live documents may reference them.

```sh
docker build -f packages/ceremony/ccdp.Dockerfile \
  -t libid-ccdp packages/ceremony/dist-artifacts
docker run --rm -p 8080:80 libid-ccdp
```

The image contains only `public/` and generated `sws.toml`. Place it behind a
transparent HTTPS ingress on a dedicated cookie-free origin. Preserve exact paths,
headers and Brotli negotiation. Configure the independently deployed OAuth Bridge
according to [OAUTH_BRIDGE.md](docs/oauth-bridge.md); ceremony supplies no production
Bridge server. The Bridge inserts deployment JSON into `/ccdp/callback.html` and serves the
complete document with matching CSP hashes; Callback owns URL clearing and bundled
version selection, with no browser entry-script request.

Optional opener-independent fallback belongs to `@libid/popup`. A distribution
integrator may set the code-owned `build/popup.ts` adapter module and its connect
sources, and supply the corresponding constructor on the application side. There
is no WebRTC implementation or browser-selected carrier configuration here.

## Checks

```sh
pnpm --filter @libid/ceremony typecheck
pnpm --filter @libid/ceremony typecheck:e2e
pnpm --filter @libid/ceremony test
pnpm --filter @libid/ceremony test:distribution
pnpm --filter @libid/ceremony test:e2e:install
CEREMONY_SWS_URL=http://127.0.0.1:8080 pnpm --filter @libid/ceremony test:distribution
CEREMONY_SWS_URL=http://127.0.0.1:8080 pnpm --filter @libid/ceremony test:e2e
```

Build artifacts first. Browser checks use HTTPS ports 4681–4683 and actual popup
code; `CEREMONY_SWS_URL` forwards CCDP requests to the real image. Without it, the
harness serves emitted bodies/policies directly and does not qualify SWS. Tests
include controlled real Google proofs verified in a separate Node process against
the released key. They do not automate real consent. Live consent and devices use
the opt-in walkthrough in [QUALIFICATION.md](docs/qualification.md).
