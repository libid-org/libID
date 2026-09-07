# OAuth Bridge Server

This document defines the HTTP and deployment contract for the OAuth-owning
OAuth bridge used by `@libid/ceremony`. The bridge publishes platform
configuration, serves the OAuth callback document, and performs the one
confidential platform exchange required by GitHub.

The package API is defined in [ARCHITECTURE.md](architecture.md), the callback
participant in [CCDP](../src/ccdp/documents/docs/documents.md#callback-get-callbackjs), and proof generation in
[PROVING.md](../src/prover/docs/proving.md). The normative libID specification owns authorization,
platform-return, token-exchange, and proof semantics; this document fixes only
the bridge's public transport and deployment boundary.

## Boundary

The OAuth bridge owns:

- OAuth application registrations, public client IDs, and confidential client
  credentials;
- the public ceremony configuration;
- callback ingress, its configured path, response policy, and deployment
  inputs; and
- GitHub's confidential token exchange and token attestation when GitHub is
  enabled.

CCDP owns and serves the versioned Callback implementation. The bridge serves
only the registered callback shell, which loads that implementation from its
configured CCDP origin. The bridge does not serve CCDP
[resources](../src/ccdp/documents/docs/documents.md#documents-and-routes), prover modules, circuits,
notarization client, or proving toolchain. It owns no ceremony Job and keeps no
ceremony progress, OAuth return, proof, retry, cancellation, or recovery state.
Google and X require no confidential bridge route.

Loading Callback from the CCDP Distribution adds no credential authority: the
same distribution supplies Prover, which receives the captured OAuth return
through Callback's private fragment handoff. Keeping Callback there avoids making the bridge republish
CCDP implementation artifacts.

The OAuth Bridge and CCDP origin may be cross-origin or cross-site. The bridge
origin is a code-supply-chain boundary for the callback shell and public
configuration; the CCDP origin is an independent code-supply-chain boundary
for Callback behavior and proof generation. Supplying the bridge origin to the
prover at runtime does not make the prover response deployment-specific.
Any number of independently operated Bridges may select the same public CCDP
Distribution; it does not register them or receive their application
allowlists.

## Deployment configuration

One bridge deployment has these inputs:

| Input | Contract |
|---|---|
| Bridge origin | Canonical HTTPS origin used by every bridge route and the configured OAuth redirect URI; explicit loopback development is the only HTTP exception |
| `allowedAppOrigins` | Nonempty, duplicate-free set of canonical HTTPS application origins admitted to fetch configuration and authenticate the callback popup connection |
| CCDP origin | One canonical HTTPS origin selected by the operator; defaults to `https://lib.id` when omitted |
| Callback path | Developer-configurable fixed path whose default is `/auth/callback`; registered as every enabled platform's OAuth `redirect_uri` |
| Platform profiles | Public OAuth client ID and supported ceremony versions for each enabled platform |
| Callback shell | Supported CCDP versions, current default input tuple, optional per-version input overrides, and response-policy sources required to load [Callback](../src/ccdp/documents/docs/documents.md#callback-get-callbackjs) from the configured CCDP origin |
| GitHub settings | Client secret, redirect URI, token endpoint settings, and server-side notary settings when GitHub is enabled |

`allowedAppOrigins` has no protocol maximum. A duplicate or invalid member is a
deployment error rather than something the bridge normalizes. The set drives
configuration CORS and is embedded into the callback document. It is never
inferred from a request's `Origin`, `Referer`, query, fragment, or body.

The CCDP origin is likewise deployment data. It is returned to the
application in public configuration and embedded into the callback document so
Callback can navigate the popup to Prover. It does not identify an
artifact, circuit, or notary endpoint. Omitting it selects the canonical
`https://lib.id` Distribution.

One platform configuration generates both the public profile entries and the
OAuth registrations used by the callback. The bridge advertises only
platform/version pairs supported by its selected CCDP Distribution. Selecting
a shared Distribution requires no reciprocal configuration; when GitHub is
enabled, this Bridge independently admits its exact CCDP origin at the
confidential token endpoint.

## Route surface

The bridge exposes only:

| Method | Route | Availability | Purpose | Origin enforcement |
|---|---|---|---|---|
| `GET` | `/api/v1/ceremony/config` | always | public platform and CCDP configuration | exact allowed browser origin; absent `Origin` accepted only by the same-origin rule below |
| `GET` | configured callback path, default `/auth/callback` | always | registered OAuth callback shell | none at HTTP ingress; callback authenticates its popup connection after clearing its input |
| `OPTIONS`, `POST` | `/api/v1/ceremony/github-token` | only when GitHub is enabled | confidential GitHub token exchange and token attestation | exact request `Origin` equal to the configured CCDP origin; exact noncredentialed CORS |

Top-level navigation may omit `Origin`, and an OAuth-platform callback may
identify the platform rather than the application. `Referer` is never an
authority input. The callback document is therefore public and
request-invariant; its browser protocol authenticates the application after it
loads.

No Callback implementation, prover, proving-asset, preparation, continuation,
polling, status, result, cancellation, browser TLS bridge, or proof-recovery
route exists on the OAuth bridge. Unsupported methods fail without route work.
Except for the OAuth-platform-mandated callback query and the GitHub JSON
request, bridge routes accept no query or request body.

The `v1` in `/api/v1/ceremony/...` versions the bridge's JSON API.
The configured callback path is a browser protocol document; its shell selects
`CCDPVersion` from OAuth `state`.
`PlatformCeremonyVersion` independently versions one platform ceremony. There
is no request-time version negotiation.

## Public configuration

`GET /api/v1/ceremony/config` returns `application/json` with this exact record:

```ts
import type { PlatformCeremonyVersion } from '@libid/ceremony'

interface PlatformConfig {
  clientId: string
  ceremonyVersions: readonly PlatformCeremonyVersion[]
}

interface CeremonyConfig {
  redirectUri: string
  ccdpOrigin: string
  platforms: Readonly<Record<string, PlatformConfig>>
}
```

The response rules are:

- `PlatformCeremonyVersion` is an unsigned 16-bit integer.
- `redirectUri` is the canonical registered URL on the bridge origin. It
  contains no credentials, query, or fragment.
- `ccdpOrigin` is the configured canonical HTTPS origin with no credentials,
  path, query, or fragment.
- Each platform entry has one public client ID and a nonempty, duplicate-free
  list of supported ceremony versions. List order has no meaning.
- Unknown fields, malformed URLs, and unsupported numeric representations are
  invalid. A platform absent from the client's closed local catalog is ignored;
  known entries remain exact-validated before use.
- The record contains no secret, `allowedAppOrigins`, artifact URL, CSP source,
  notary setting, platform display metadata, or application-specific value.

When present, `Origin` must exactly match an `allowedAppOrigins` member. A
successful cross-origin response sets that exact origin in
`Access-Control-Allow-Origin`, permits no credentials, and never uses `*`.
A same-origin browser GET may omit `Origin`: accept that case only when
`Sec-Fetch-Site` is `same-origin` and the Bridge's configured public origin is
itself in `allowedAppOrigins`. It needs no CORS response header. Do not infer
admission from `Referer`, the request host, or absent Fetch Metadata; an explicit
invalid, `null`, or unlisted `Origin` always fails.

Both cases use `Content-Type: application/json`, `Cache-Control: no-store`,
`Vary: Origin, Sec-Fetch-Site`, and `X-Content-Type-Options: nosniff`. Rejected
requests return no configuration. These browser admission checks do not make
the public record a secret from non-browser clients. Request values do not
alter the response record.

The application-scoped `CeremonyClient` fetches and validates this record once
at creation using `credentials: 'omit'`. It freezes the selected client ID,
redirect URI, CCDP origin, and mutually supported platform ceremony version
in each live ceremony. CCDP
[resources](../src/ccdp/documents/docs/documents.md#documents-and-routes) never fetch bridge configuration.

## Callback document

The configured callback path serves one deployment-generated callback document.
Each enabled OAuth application registers the same URL as its `redirect_uri`.
There is no callback alias or HTTP redirect.

The response is invariant across requests. Its HTML, headers, supported-version map, CSP,
embedded `allowedAppOrigins`, and CCDP origin do not depend on request
`Origin`, `Referer`, query, fragment, platform, or ceremony. The document is
top-level, non-isolated, and non-frameable so it preserves the application
opener whenever OAuth-platform policy permits.

The OAuth Bridge owns the shell's input handling, clearing, version selection,
response policy, and module invocation. It embeds only the closed
supported-version map, optional input overrides, `allowedAppOrigins`, the
configured CCDP origin and fixed CSP sources. CCDP owns the
invoked [Callback](../src/ccdp/documents/docs/documents.md#callback-get-callbackjs) behavior.

### Shell document

The response contains only the semantic equivalent of:

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
    <script type="module">/* deployment-generated bootstrap */</script>
  </body>
</html>
```

The exact bootstrap is inline so it can clear credentials before requesting any
subresource. Its CSP hash is generated from its exact deployment bytes. The
document contains no external config script, preload, analytics, application
markup, or request-derived interpolation. The Callback implementation owns all
later UI. Its cross-origin module request carries no credentials and follows
only the configured CCDP origin and selected version.

The bootstrap embeds one current default input tuple, a closed list of supported
CCDP versions, and optional per-version input overrides. The implementation URL
is derived only after the version is found in that list. Version 1 is equivalent
to:

```ts
const ccdpOrigin = 'https://lib.id'
const defaultInputs = deepFreeze([
  ['https://app.example'],
  ccdpOrigin,
])

const supportedCCDPVersions = Object.freeze([1])
const callbackInputOverrides: Readonly<
  Partial<Record<number, readonly unknown[]>>
> = Object.freeze({})
```

Neither URL input nor a network response can add a supported version or input
override.

### Stable implementation input

After selecting and importing an implementation, the bootstrap calls its sole
entrypoint with the captured location followed by its override or the deeply
frozen default inputs:

```ts
interface CallbackLocationInput {
  query: string
  fragment: string
}

const moduleUrl = new URL(
  `/ccdp/v${version}/callback.js`,
  ccdpOrigin,
).href
const callback = await import(moduleUrl)
callback.startCallback(
  locationInput,
  ...(callbackInputOverrides[version] ?? defaultInputs),
)
```

`query` and `fragment` are the bounded byte-for-byte OAuth-return URL components
captured before clearing, including their leading delimiter when nonempty. The
implementation exact-validates the selected shape, including unknown fields,
before using it and copies the origin list again before popup acceptance. For
CCDP version 1, the implementation defines and exact-validates this signature:

```ts
declare function startCallback(
  locationInput: CallbackLocationInput,
  allowedApplicationOrigins: readonly string[],
  ccdpOrigin: string,
): void
```

The shell-to-implementation contract is deliberately unversioned and fixed.
URL input is always the raw query/fragment pair, while both default and overridden `inputs`
are opaque to the shell. Each CCDP Callback implementation defines and
exact-validates its own argument tuple. Implementations use the latest deployment
values by default. Before changing the tuple incompatibly, the deployment pins
the previous tuple only on versions that still require it. This changes neither
the shell algorithm nor the browser URL. Neither URL input nor a network
response may supply arguments.

### Bootstrap algorithm

Before module import, rendering, storage, error reporting, or other network use,
the inline bootstrap:

1. bounds and copies the raw query and fragment;
2. clears both with `history.replaceState` while retaining the same path;
3. accepts only an OAuth-platform return containing exactly one routing `state`;
4. reads only the `v<version>.` prefix from OAuth `state` and rejects malformed
   or unsupported values;
5. selects the corresponding version and its optional input override;
6. deeply freezes the captured location and resolved inputs; and
7. imports `{ccdpOrigin}/ccdp/v{CCDPVersion}/callback.js` and invokes its
   `startCallback` entrypoint once with the resolved inputs.

Any failure imports no other implementation and renders only fixed text after
clearing.
The bootstrap never parses a platform credential, selects a prover asset, or
uses `Origin` or `Referer` as configuration.

Google returns its credential in the fragment, which is never sent to the
bridge. X and GitHub return OAuth-platform-mandated callback parameters in the query.
The bridge and every upstream proxy suppress or redact callback query strings
from access logs, traces, analytics, metrics labels, and error reports. No
later request URL carries the captured return. Callback may forward it only
through the private Prover fragment defined by CCDP, after authenticating the
Application; every receiving document captures and clears it before use.

The callback response uses:

- `Cross-Origin-Opener-Policy: unsafe-none`;
- `Content-Type: text/html`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`;
- CSP beginning with `default-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'none'`, and `frame-ancestors 'none'`;
- `frame-src` admitting only the exact configured CCDP origin;
- `connect-src` admitting only fixed sources required by the configured popup
  fallback;
- `style-src 'unsafe-inline'` for package-owned inline styles, with no external
  stylesheet sources or Bridge-pinned stylesheet hash;
- one exact hash for the inline clearing bootstrap and only the exact supported
  Callback implementation URLs on the configured CCDP origin; and
- no broad scheme, JavaScript `'unsafe-inline'`, or `'unsafe-eval'` source.

The CCDP Distribution's Callback module uses its
[protocol-resource response profile](../build/docs/distribution.md#protocol-resources).
Markup, styles, and logo remain package-owned. There is no styling customization
input, template, or theme contract. Compatible Callback UI changes require no
Bridge update; inline styling permission does not permit inline JavaScript.

## GitHub token endpoint

When GitHub is enabled, `POST /api/v1/ceremony/github-token` performs the
confidential OAuth token exchange and token TLSNotary session synchronously. It
retains no state. The prover derives this fixed route from the origin of the
Ceremony Client's frozen `redirectUri` in `AppStartProver`; the prover document
does not embed it.

The bridge API version implements GitHub ceremony version `1` only. The request
carries no ceremony-version field, and configuration must not advertise a
GitHub version requiring different token-service semantics. Such a change
requires a new bridge API version.

```ts
interface TokenRequest {
  code: string
  codeVerifier: string
}

interface TokenResponse {
  accessToken: string
  tokenAttestation: {
    attestedData: string // canonical unpadded base64url
    signature: string    // canonical unpadded base64url
  }
  bearerOpening: string // canonical unpadded base64url
}
```

Both records are UTF-8 JSON objects. Member order and insignificant whitespace
have no meaning. Duplicate, missing, additional, or wrongly typed members are
invalid. The versioned route carries no redundant schema field.

`code` is nonempty printable ASCII without whitespace or control bytes and at
most 1,024 bytes. `codeVerifier` matches `[A-Za-z0-9_-]{43}`. The bridge does
not normalize either value.

`accessToken` is nonempty printable ASCII without whitespace or control bytes
and at most 128 bytes, matching GitHub v1's bearer circuit. Both Bridge and
Prover enforce this bound before dependent identity notarization; an oversized
token fails rather than being truncated. `attestedData` decodes to a nonempty
byte-exact record of at most 2 MiB; `signature` decodes to exactly 65 bytes; and `bearerOpening`
decodes to exactly 16 bytes. Every byte string uses canonical unpadded base64url.
The encoded response body is at most 3 MiB.

The returned fields are one correlated result: the uniquely framed bearer
commitment in `tokenAttestation.attestedData` equals
`SHA256(accessToken || bearerOpening)`. The bridge preserves signed attestation
bytes exactly. Before its dependent identity notarization, the prover validates
the response encoding, correlation, and open request bindings. Local notary
signature verification remains optional; downstream proof verification is
authoritative.

The endpoint contract is:

- the query is empty and the request media type is exactly `application/json`;
- preflight and POST `Origin` exactly equal the configured CCDP origin;
- successful preflight admits only `POST` and `Content-Type`, uses no
  credentials, and returns no ceremony data;
- malformed UTF-8, JSON, or fields fail before token exchange;
- client ID, client secret, redirect URI, GitHub endpoint, notary, proxy, and
  destination come only from bridge configuration;
- redirects are rejected and request duration and response size are bounded;
- success is status `200` with exact noncredentialed CORS,
  `Content-Type: application/json`, `Cache-Control: no-store`, and one bounded
  `TokenResponse`;
- credentials and OAuth-platform-return values never enter logs, traces, analytics,
  metrics labels, or error bodies; and
- failure returns no partial credential, attestation, or caller-selected
  diagnostic content.

Timeout, duplicate request, restart, or response loss leaves no bridge record.
There is no action ID, polling route, progress stream, or response recovery; a
lost response requires a fresh ceremony.

## Compatibility

A live page keeps its loaded callback module and embedded configuration. A
breaking JSON request or response changes the bridge API version. CCDP,
platform ceremony, prover release, and popup connection versions remain
independent as defined in
[ARCHITECTURE.md](architecture.md#versioning-and-compatibility).
