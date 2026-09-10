# @libid/ceremony

Browser identity ceremonies over a caller-supplied `@libid/popup` connection.
Google, X and GitHub have closed version-1 implementations. The application owns
window creation, native-anchor launch, wallet operations, submission and what
happens after the result. Ceremony owns its UI and has no styling API.

**This implementation is not launch-qualified.** Real proof generation and
static-distribution checks are separate from real OAuth, matched-notary concurrency
and device qualification. See [QUALIFICATION.md](qualification.md) for evidence,
remaining prerequisites and the complete [requirement index](test-plan.md).

See the [documentation index](README.md) and [source guide](source.md) for
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
const ceremony = client.new(
  connection, id, ledgerId, 'google', operationDomain, transactionData,
)
anchor.href = ceremony.launchUrl
if (popup.opened) event.preventDefault() // otherwise allow the real anchor
const off = ceremony.onEvent(({ stage, platformStep }) => {
  // Optional advisory application UI; the Prover's own UI remains authoritative.
})
try {
  const result = await ceremony.proveUserIdentity()
  if (result.status === 'accepted') {
    // Pass result.identity, result.oauthProof and the original operation inputs
    // to the application's chosen ledger adapter.
    // Accepted means structurally accepted Prover output, not ledger verification.
  }
} finally {
  off()
}
```

**Real ledger definitions are deferred.** The shared [ledger package](../../ledger/README.md)
currently has no supported production identifiers. The test harness uses its explicit
synthetic fixture; normal builds reject those identifiers.

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
Client validates the separate identity and proof structures, matches the OAuth client
identifier, and wraps the proof with its selected version and authorization nonce. Original attested bytes and signatures are preserved for downstream checks.

## Package layout

| Path | Owner |
|---|---|
| [src/client/](client.md#implementation-guide) | Configuration, frozen construction, one-shot application state |
| [src/ccdp/](protocol.md#implementation-guide) | Seven message companions and navigation-fragment codecs |
| [src/platforms/](pipelines.md#implementation-guide) | Authorization, proof type, asset set and proof pipeline |
| [src/prover/](proving.md#implementation-guide) | Dedicated Noir/bb.js proof worker |
| [src/prover/notarization/](notarization.md#implementation-guide) | Browser TLSNotary sessions, canonical decoding and correlation |
| [src/prefetch/](prefetch.md#implementation-guide) | Root Service Worker, byte caches and pending-fetch joins |
| [src/ccdp/documents/](documents.md#implementation-guide) | Callback, Prefetch and Prover page entrypoints |
| `src/ui.ts` | Native, package-owned DOM and progress |
| [build/](build.md) | Compiler-owned graph and static response policies |
| [e2e/](browser-tests.md) | Independent HTTPS origins and actual-popup browser checks |

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
pnpm --filter @libid/ledger build
pnpm --filter @libid/ceremony build
pnpm --filter @libid/ceremony build:ccdp-artifacts
```

Owner-defined archive URLs pin circuit v0.3.0 and notary v0.3.0-rc.2 releases.
The build caches HTTPS downloads under `.cache/downloads/`, mounts archive members
without renaming them, and resolves the notary snippet wildcard exactly once.
There is no bundle-path environment variable or handwritten checksum list.
`LIBID_NOTARY_ADDRESS` optionally replaces both fixed addresses at build time and
changes the emitted execution policy.
Without an override, Prover decodes the frozen ledger encoding and its classification selects
`https://notary.lib.id` or `https://testnet.notary.lib.id`; both share the same
assets and response. Prover forwards the resolved `notaryAddress` to the GitHub
Bridge for the token session and uses that same address for its identity session.
The Bridge owns egress/DNS protections for this request-controlled destination.
There is no Bridge-side network mapping or second override. `--out-dir` selects another dedicated
output directory inside the checkout. Rebuilding into an existing artifact retains
its previous immutable responses and headers; use that accumulated artifact for
compatible promotion. Preserve it across CI jobs. Do not discard old immutable
resources while live documents may reference them.

```sh
docker build -f packages/ceremony/ccdp.Dockerfile \
  -t libid-ccdp packages/ceremony/dist-artifacts
docker run --rm -p 8080:8787 libid-ccdp
```

The image contains only `public/` and generated `sws.toml`. Place it behind a
transparent HTTPS ingress on a dedicated cookie-free origin. Preserve exact paths,
headers and Brotli negotiation. Configure the independently deployed OAuth Bridge
according to [OAUTH_BRIDGE.md](oauth-bridge.md); ceremony supplies no production
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

Browser tests require `build:qualification-artifacts`, which aliases the shared
ledger testing entrypoint in both Client and Prover and emits
`.cache/qualification-assets`. Build the test SWS image from that directory and
set `CEREMONY_ARTIFACT_DIR` to its absolute path for `test:distribution`. This is
separate from the normal `dist-artifacts` build, which contains no fixture decoder.
Browser checks use HTTPS ports 4681–4683 and actual popup
code; `CEREMONY_SWS_URL` is required and transparently forwards CCDP requests to
the real image, preserving native compression, validators and range responses. Tests
include controlled real Google proofs verified in a separate Node process against
the released key. They do not automate real consent. Live consent and devices use
the opt-in walkthrough in [QUALIFICATION.md](qualification.md).
