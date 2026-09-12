# CCDP Distribution

This document defines the static browser resources and proving assets required
by [CCDP](ccdp.md#documents-and-routes). CCDP owns the protocol routes,
fragments, roles, navigations, and versions; this document owns their HTTP,
response, artifact-compatibility, and publication contract. Build scripts,
source-module APIs, dependency releases, and serving software are implementation
choices, not protocol requirements.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

## Distribution boundary

One CCDP Distribution is served from one canonical `ccdpOrigin` under the
[CCDP origin policy](ccdp.md#origin-policy): HTTPS, or HTTP on exact `localhost`
and `127.0.0.1` hosts. It contains:

- every protocol resource for each supported CCDP version, including one
  self-contained Callback artifact containing its supported implementations; and
- their bundled JavaScript, workers, WASM, circuits, and libID-owned assets.

The resource graph distinguishes distributed assets from external assets.
Browsers prefetch and fetch external resources at their declared absolute
URLs; the static build does not download or mirror them. External asset availability and readable CORS remain release-qualified
dependencies rather than guarantees supplied by this host.

The OAuth Bridge separately serves ceremony configuration, the registered
Callback document, and enabled confidential platform endpoints. It retrieves
the public Callback artifact server-side and inserts its deployment data before
serving it; this does not change the document's OAuth Bridge origin. Requests
to the OAuth Platform, OAuth Bridge, Notary Service, and public platform APIs are
protocol traffic rather than CCDP assets.

The Distribution may be the canonical libID release or an operator-selected
replacement. Replacing it changes the code-supply-chain authority for Callback
and proof generation.

One Distribution may serve any number of independently operated OAuth Bridges.
It does not enumerate or register them: each Bridge selects a `ccdpOrigin`,
which serves the same public resources to all of them. A Bridge advertises only
platform/version pairs present in its selected Distribution; no shared
deployment system is required.

## HTTP contract

The Distribution is static and request-invariant. It sets no cookies, serves no
unrelated same-origin application API, and performs no request-time compilation,
templating, source resolution, archive extraction, or remote asset fetch.

### Protocol resources

- REQ-DIST-01 (upholds SP-CCDP-01): The Distribution MUST serve the resources
  with the request invariance, executable-source restrictions, and response
  policies below.

The Distribution exposes the exact versioned
[resources](ccdp.md#documents-and-routes) defined by CCDP. Their fragments,
roles, and execution contexts remain CCDP rules.

Prefetch and Prover contain their clearing bootstrap and entry code directly,
with no browser-visible manifest or second entry-script request. They may load implementation-private immutable chunks.

The aggregate [Callback artifact](#callback-artifact) is retrieved server-side
by OAuth Bridges; the contract below defines its configuration slot, embedded
startup, and the response they serve.

Each supported path has one decoded representation and response policy.
`Accept-Encoding` may select only a Brotli or gzip transfer representation defined
below. Conditional caching may return `304 Not Modified`; otherwise query
values, request headers, `Origin`, `Referer`, cookies, and user agent cannot
select different bytes, policy, embedded configuration, or implementation. A
nonempty query may receive the same static resource, but its clearing bootstrap
rejects before protocol execution. Only `GET` and `HEAD` are defined. Unknown
paths and versions return an inert failure without fallback or redirect; other
methods execute no CCDP code.

The not-found response is static HTML containing no script, style, link, form,
redirect, or protocol data.

Versioned protocol resources and the aggregate Callback artifact use
`Cache-Control: no-cache` and an ETag so a path may receive compatible
implementation updates. A breaking protocol change publishes new versioned
routes and adds its implementation to the Callback artifact. The Bridge serves
its configured Callback response with `no-store`, independently of its own
upstream artifact cache.

All protocol resources send their exact media type and
`X-Content-Type-Options: nosniff`. Top-level documents additionally send
`Referrer-Policy: no-referrer` and are not frameable. Document CSP begins with
`default-src 'none'`, `object-src 'none'`, `base-uri 'none'`,
`form-action 'none'`, and `frame-ancestors 'none'`; admits only the exact
build-generated entry code, resources, and network sources needed by that
document; and uses neither JavaScript `'unsafe-inline'` nor `'unsafe-eval'`.
Document-owned inline styles may use `style-src 'unsafe-inline'`; no caller
markup, executable code, or styling input is part of this contract.

| Resource | Form | Additional response contract |
|---|---|---|
| [Callback artifact](#callback-artifact) | self-contained HTML template at `/ccdp/callback.html`, retrieved server-side by OAuth Bridges | `text/html; charset=utf-8`, `no-cache` and ETag, with exact executable hashes in CSP. No browser CORS permission is needed for this retrieval. The configured response follows [Served response](#served-response). |
| Prefetch | top-level non-isolated HTML | `Cross-Origin-Opener-Policy: unsafe-none` and no COEP. Script/worker sources remain same-origin; `connect-src` admits local assets and the pinned external asset origins. |
| Prover | top-level HTML | `Document-Isolation-Policy: isolate-and-require-corp`, `Cross-Origin-Opener-Policy: unsafe-none`, and no COEP. |
| Prover isolation fallback | top-level HTML at `/ccdp/v{CCDPVersion}/prover/fallback` | `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Same Prover entrypoint, fragment contract, and non-isolation response rules. |
| Worker | module Service Worker JavaScript | `text/javascript; charset=utf-8` and `Service-Worker-Allowed: /`. Prefetch registers it with `scope: '/'`; it remains compatible with every live CCDP version and passes unrelated requests through unchanged. Code is same-origin; `connect-src` also admits the pinned Aztec CRS origins for asset caching. |

The Distribution may publish smaller Brotli and gzip transfer representations.
It selects an available representation admitted by `Accept-Encoding` (including
quality values), otherwise the original. A compressed response keeps the original
media type and policy, declares its `Content-Encoding`, and varies on
`Accept-Encoding`. Decoding produces the exact original bytes. Native serving
software may supply validators and transfer framing; the protocol requires no
custom compression or ETag implementation.

Both Prover responses close script and worker sources to the build-generated
same-origin graph and toolchain-required `blob:` workers. Every context that
fetches distributed assets, including Prefetch, Prover, the Service Worker,
and dedicated workers, admits `'self'` in `connect-src`; same-origin HTTP
assets must not be accidentally excluded by an HTTPS-only source list.

Prover additionally admits `https: wss:` for declared external assets,
validated third-party OAuth Bridges, and secure notary WebSockets. Its local
Bridge HTTP sources are `http://localhost:* http://127.0.0.1:*`; its local
notary WS sources are `ws://localhost:* ws://127.0.0.1:*`. Both Prover responses
include these fixed sources for default and custom ports. Dedicated workers
include the corresponding sources where they perform Bridge or notary requests.
No resource admits a general `http:` or `ws:` source. Generated policy does
not add `upgrade-insecure-requests` or otherwise force local requests to TLS.
Script and worker loading remains same-origin under either permitted scheme;
these fetch exceptions admit no remote code. The Distribution embeds no
selected notary address, profile, or environment override; one byte-identical
response supports the same admitted origins in local and hosted deployments.
Selection changes no asset or cache key. This policy permits those network
schemes and explicit loopback hosts, not just the selected notary; application
code enforces destination selection.

Every context fetching an external resource admits its declared request
origins, including fallback origins, without allowing external executable code.
Requests use noncredentialed readable CORS under both Prover responses,
including any declared Range requests; opaque responses and `no-cors` are
not substitutes. Availability and CORS policy remain external dependencies.

Every context that compiles WASM, including dedicated proof and TLSNotary
workers, includes `script-src 'wasm-unsafe-eval'` alongside its code sources.
This permits WASM compilation, not JavaScript string evaluation. External execution worker scripts additionally carry
`Cross-Origin-Embedder-Policy: require-corp`. They have their own CSP; they do not rely on the document's CSP.
Blob workers inherit their creator's policy. Worker profiles admit only their
required script, asset, and protocol connections, and `worker-src` admits
same-origin or `blob:` children only for workers that spawn them. The Service
Worker only caches bytes and keeps ports: it needs no WASM compilation permission.

Each request-invariant Prover response supports multiple platform profiles and
arbitrary OAuth Bridges satisfying the [origin policy](ccdp.md#origin-policy).
CSP cannot express a runtime-selected exact Bridge origin, so its HTTPS class
and fixed localhost HTTP sources are not per-Bridge compartmentalization.
Prover derives GitHub's fixed token route only from the
validated `redirectUri` frozen by the Application; no message supplies another
Bridge endpoint. Compromised Prover code can use every network class admitted
by the response.

### Callback artifact

- REQ-DIST-02 (upholds SP-CCDP-01): The Distribution MUST publish Callback
  according to the insertion, browser-entry, and served-response contracts below;
  the Bridge MUST validate and configure it according to that same contract.

`GET /ccdp/callback.html` supplies a complete Callback document for
[OAuth Bridges](oauth-bridge.md#callback-document) to configure and serve at
their registered redirect URI. It executes on that Bridge's origin, without
a separate shell, HTTP redirect, or browser-side entry-script fetch.

The artifact bundles the supported CCDP Callback implementations and their
dependencies. Its version-independent path lets the browser select a bundled
implementation from OAuth `state`, including Google fragment returns which
the Bridge cannot see. It contains no Bridge configuration and cannot accept
a connection until configured; a direct visit clears URL input and fails
locally on the missing deployment data.

#### Configuration insertion

The artifact contains the semantic equivalent of:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>libID</title>
  </head>
  <body>
    <main id="libid-root"></main>
    <script id="libid-callback-config" type="application/json">__LIBID_CALLBACK_CONFIG__</script>
    <script type="module">/* complete bundled Callback code */</script>
  </body>
</html>
```

The build produces exactly one configuration marker, in this non-executable
data block. The bridge substitutes serialized deployment data there, never
JavaScript source. Serialization escapes `<` as `\u003c` so data cannot terminate
the script element or introduce markup. Missing or repeated markers reject the
artifact. No callback request value participates in substitution.

The inserted data is one unversioned JSON list, `[allowedOrigins, ccdpOrigin]`,
using the Bridge's [effective allowlist](oauth-bridge.md#deployment-configuration):

```json
[
  ["https://app.example", "https://lib.id"],
  "https://lib.id"
]
```

There is no version-keyed wrapper, input-declaration block, or Bridge-side
CCDP version list. Every bundled Callback implementation receives a deeply
frozen copy of the same list. The first two positions require a nonempty,
duplicate-free allowlist of canonical origins containing the configured CCDP
origin, and that origin itself. Both use the
[CCDP origin policy](ccdp.md#origin-policy), including its HTTP localhost
exception. These match the effective admission
set and public `CeremonyConfig` respectively. The list contains no secrets.
Neither URL input nor an upstream artifact supplies deployment values.

Compatible evolution preserves existing positions, types, and meanings. New
optional trailing inputs may be defaulted when absent by newer implementations
and ignored by older ones. New CCDP versions using that compatible contract
require no Bridge change. A new required input or incompatible interpretation
instead requires an explicit input-contract version and corresponding Bridge
support; no such versioning is defined until needed.

This is a data-insertion contract, not a UI template or renderer API. Callback
owns its code and presentation. Its dependencies are
bundled into this HTML rather than loaded relative to the bridge or fetched
from the Distribution by the browser.

#### Browser entry

URL clearing, version dispatch, and startup/failure UI are built and tested
with the bundled Callback implementations, not implemented by the Bridge.
A live document keeps the code and configuration it received.

The embedded Callback code, before rendering, storage, error reporting, or any
network use:

1. bounds and copies the raw query and fragment, then clears both with
   `history.replaceState` while retaining the same path;
2. requires exactly one routing `state` and reads its `v<version>.` prefix;
3. rejects a malformed version or one absent from its bundled implementations;
4. requires a JSON input list, validates the inputs used by the selected
   implementation, and freezes the list and captured location; and
5. enters the selected Callback implementation once, without dynamic import.

Oversized or malformed input is cleared and renders only fixed failure text.
A version absent from the bundle, including a retired version, displays a
package-owned message such as **This ceremony version is no longer supported.
Update the application and try again.** It establishes no connection, emits no
protocol message, and never substitutes another version. No retired transport
or abort-message implementation is retained for this screen. Applications need
no version-specific failure UI and receive no protocol notification of this
local failure; their ordinary cancellation/connection-failure handling remains.

Missing or malformed required inputs likewise render fixed local
failure text without establishing a connection or emitting a protocol message.

No platform credential is parsed here. The selected Callback
authenticates the Application against its configured allowlist before the
captured return can leave this document, then follows
[CCDP](ccdp.md#callback-get-redirecturi).

#### Served response

For one active artifact/configuration pair, HTML and headers are invariant
across requests. Nothing is derived from request `Origin`, `Referer`, query,
fragment, platform, or ceremony. The completed response uses:

- `Cross-Origin-Opener-Policy: unsafe-none`, without COEP;
- `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`;
- CSP beginning with `default-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'none'`, and `frame-ancestors 'none'`;
- `frame-src` admitting only the exact configured CCDP origin, retaining HTTP
  and the configured port for an admitted localhost origin;
- `connect-src` admitting only fixed sources required by the configured popup
  fallback;
- `style-src 'unsafe-inline'` for package-owned inline styles; and
- `script-src` containing only the build-generated hashes for the bundled
  executable code, with no external script source, JavaScript
  `'unsafe-inline'`, or `'unsafe-eval'`.

The bridge combines the artifact's executable hashes with its own
deployment-specific policy, not an upstream policy permitting arbitrary
sources. Data substitution does not change executable bytes. Artifact and
matching policy update atomically; compatible UI changes require no manual
stylesheet hash, theme, or styling configuration.

The Bridge accepts only a successful HTML artifact with the required unique
data slot and hash-only executable script policy. It performs substitution on
the decoded body and composes the final HTML and headers as one unit. Upstream
cache and transfer headers are not copied: the source artifact is revalidated,
while the configured browser response is non-cacheable.

### Prover isolation

- REQ-DIST-03 (upholds SP-CCDP-01): The Prover and its host MUST preserve the
  isolation, fragment, and root-registration behavior described below.

CCDP has one logical [Prover](ccdp.md#prover-get-prover). The primary response
requests Document Isolation Policy without severing the opener; an unisolated
arrival uses the same-origin fallback response through the
[popup transport's isolation replacement](popup-transport.md).
The two responses are not separate CCDP participants or phases.

Both execute the same Prover implementation and fragment contract. They capture
and clear incoming fields before other work and preserve that capture through
replacement. Neither exposes readiness or executes proof work before isolation
and connection establishment succeed. If the fallback is still unisolated,
establishment fails; it does not loop or silently prove without shared memory.

Both paths resolve the canonical root-scope Worker registration. A stale
`/ccdp/v1/` registration, even with the same script URL, is not that registration.
The host and participants uphold the popup transport's same-registration
continuity prerequisite. Successful DIP avoids replacement; fallback needs no
second window or extra user action. This mechanism does not repair an opener
already severed by the OAuth Platform; authenticated carrier fallback is a
separate popup-transport concern.

### Proving assets

- REQ-DIST-04: The Distribution MUST preserve the asset URL, byte, metadata,
  and selected-profile resource contracts below. Necessity: Prefetch and Prover
  must share compatible assets without runtime source negotiation.

`GET /ccdp/assets/*` is the Distribution's static proving-resource namespace,
not a CCDP API or versioned protocol route. Locally served proving resources
other than the versioned protocol resources resolve there; Aztec CRS requests
retain their upstream URLs. CCDP
assigns no structure to the suffix: versioned code pins each exact path, while
protocol code neither enumerates nor parses the namespace.

Each asset response:

- has a canonical path with no query, fragment, mutable alias, or redirect;
- serves one immutable byte sequence with its exact media type and `nosniff`;
- uses `Cross-Origin-Resource-Policy: same-origin`; and
- uses `Cache-Control: public, max-age=31536000, immutable`.

A release pins the resource graph for every supported platform ceremony version.
Requests, fragments, messages, and Application inputs cannot replace that graph.
Every local path referenced by published code exists; no browser-visible asset
catalog or request-time source resolution is required. External resources retain
their declared URLs. Prefetch and execution resolve the same selected-profile
resources, including shared resources, so their downloads and caches are reusable.

### Publication and compatibility

- REQ-DIST-05: The Publisher MUST activate a locally asset-complete release
  and retain immutable paths as specified below. Necessity: compatible updates
  must not invalidate live ceremonies or reusable cached bytes.

Activation is asset-complete: every immutable resource referenced by an updated
protocol resource or Worker is retrievable with its final bytes and response
metadata before that update becomes reachable.
The external Aztec request set is qualified before promotion; CDN availability
cannot be made atomic with local deployment, and a later outage still fails
proving if no usable cache is present.

An unchanged asset retains its URL across compatible releases. Changed bytes or
execution-relevant metadata receive a new immutable URL, and old URLs remain
available while any live ceremony, supported CCDP implementation, platform
profile, or compatibility window may reference them. Runtime content hashing is
not required; release-qualified, content-addressed, and build-generated
immutable paths all satisfy this contract.

Asset revisions change `CCDPVersion` or `PlatformCeremonyVersion` only when
their observable protocol or proof semantics change.

## Security Considerations

This contract supports SP-CCDP-01 under ASM-CCDP-01 and ASM-CCDP-02.
The publisher controls executable browser code: headers and content-addressed
paths do not protect against a malicious publisher or compromised release.
CSP limits accidental source expansion, not the publisher's authority.
Request-invariant Prover policy deliberately permits classes of secure network
origins; runtime destination checks, not CSP, bind a ceremony to its Bridge and
notary. Local HTTP exceptions are confined to the popup origin policy.

Callback deployment inputs are non-executable trusted configuration. Their
insertion cannot depend on OAuth ingress, change script bytes, or introduce
markup. The Bridge keeps that configured response separate from its upstream
artifact cache. Fragments do not reach this Distribution's HTTP service.

Unreachable external resources can prevent proving despite an atomic local
deployment. Neither caching nor release qualification guarantees later CDN
availability. Common and platform specifications retain proof and trust-root
authority; this document selects no ledger verification keys.

## Conformance

Publishers, static hosts, and Bridge artifact consumers implement the roles
above. The package's build and deployment tests may qualify them with any
serving software that produces these observable responses.

- TEST-DIST-01 (exercises REQ-DIST-01):
  GET/HEAD serve invariant decoded bytes and policy; conditional/encoding responses preserve them; unknown paths are inert. Both isolation profiles support allowed local and external requests without admitting remote executable code.
- TEST-DIST-02 (exercises REQ-DIST-02):
  Exactly one data marker is inserted safely; executable hashes remain valid; missing/duplicate slots fail. Query and fragment state select a supported bundled Callback without another script request; missing/retired versions fail locally.
- TEST-DIST-03 (exercises REQ-DIST-03):
  Primary isolation or one replacement establishes the same participant; retained fragments survive. With both root and stale narrower registrations present, participants resolve root even if script URLs match.
- TEST-DIST-04 (exercises REQ-DIST-04):
  Empty-cache Prefetch and execution use the same declared resource graph; shared resources are reusable, and ranged external responses remain readable under both isolation profiles.
- TEST-DIST-05 (exercises REQ-DIST-05):
  Unchanged assets keep URLs, changed bytes get new URLs, both remain retrievable, and no updated document or Worker becomes reachable before all its local dependencies. External availability is qualified, not reported as atomic.
