# OAuth Bridge Server

This document defines the HTTP and deployment contract for the OAuth bridge
used by CCDP. The bridge publishes platform
configuration, serves the OAuth callback document, and performs the one
confidential platform exchange required by GitHub.

[CCDP](ccdp.md) owns the browser flow. The
[common](ceremony-common.md) and [platform](platform-ceremonies.md) ceremony rules
own authorization, platform-return, token-exchange, and proof semantics.
This document owns only the Bridge's public HTTP and deployment contract.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

## Boundary

The OAuth bridge owns:

- OAuth application registrations, public client IDs, and confidential client
  credentials;
- the public ceremony configuration;
- callback ingress, response policy, and deployment inputs; and
- GitHub's confidential token exchange and token attestation when GitHub is
  enabled.

For Callback, the bridge is a configuration-inserting, cached proxy to the
[CCDP Distribution](ccdp-distribution.md#callback-artifact). It neither
implements the document nor requires a TypeScript build. It serves no other
CCDP resources and stores no ceremony state. Google and X require no
confidential bridge route.

The bridge and Distribution may be cross-site and independently operated;
both are code-supply-chain trust boundaries. The Distribution requires no
Bridge registration and receives no application allowlists.

## Deployment configuration

- REQ-BRIDGE-01 (upholds SP-CCDP-01): The Bridge MUST derive its fixed redirect
  URI, effective origin allowlist, and Callback inputs from the deployment
  configuration below, not incoming requests.

One bridge deployment has these inputs. Every origin follows the
[CCDP origin policy](ccdp.md#origin-policy), including HTTP on exact
`localhost` and `127.0.0.1` hosts:

| Input | Contract |
|---|---|
| Bridge origin | Canonical origin used by every bridge route and the derived OAuth redirect URI |
| `allowedAppOrigins` | Nonempty, duplicate-free set of canonical application origins admitted by the bridge |
| CCDP origin | One canonical origin selected by the operator; defaults to `https://lib.id` when omitted |
| Platform profiles | Public OAuth client ID and supported ceremony versions for each enabled platform |
| Callback inputs | One unversioned list `[allowedOrigins, ccdpOrigin]` derived from the values above, plus deployment-policy sources required by the [artifact contract](ccdp-distribution.md#configuration-insertion); no separate input configuration or CCDP version list |
| GitHub settings | Client secret, token endpoint settings, and the notary's native MPC-TLS listener port when GitHub is enabled; the notary host remains request-selected |

Every enabled platform's OAuth registration uses
`{bridgeOrigin}/auth/callback` as its `redirect_uri`. The path is fixed, not a
deployment option. The Bridge uses this same derived URL for its confidential
token exchange; no separate redirect URI is configured.

`allowedAppOrigins` has no protocol maximum. A duplicate or invalid member is a
deployment error rather than something the bridge normalizes. After resolving
the default or configured `ccdpOrigin`, the bridge derives one effective set:
`allowedOrigins = allowedAppOrigins ∪ {ccdpOrigin}`. Adding an already-listed
CCDP origin does not duplicate it. When `ccdpOrigin` is omitted, this adds
`https://lib.id`; when overridden, only the replacement is added automatically.
`https://lib.id` then remains allowed only if explicitly listed.

The effective set governs configuration GET, callback connection authentication,
and GitHub preflight/POST admission. It is embedded into Callback, not separately
configured, and never inferred from a request's `Origin`, `Referer`, query,
fragment, or body.

The CCDP origin is likewise deployment data. It is returned to the
application in public configuration and embedded into the callback document so
Callback can navigate the popup to Prover. The bridge also resolves the fixed
Callback artifact path against it; no separate Callback artifact URL is
configured. Omitting it selects the canonical `https://lib.id`
Distribution.

An all-HTTP local setup can use Application `http://localhost:3000`, Bridge
`http://localhost:3001`, and CCDP `http://localhost:8787`. The Bridge configures
the Application in `allowedAppOrigins`, adds the CCDP origin to `allowedOrigins`,
serves Callback at `http://localhost:3001/auth/callback`, and retrieves
`http://localhost:8787/ccdp/callback.html` without requiring a local certificate.
Callback receives that same HTTP allowlist and CCDP origin; the client,
Callback, Prover, and their popup connections must not reject them solely for
using HTTP. Notary selection remains with the Application, not this config.
Platform acceptance of the registered redirect URI is a separate prerequisite.

The Bridge injects the same input list regardless of CCDP version. New versions
with compatible inputs work on artifact refresh without a Bridge rebuild or
configuration change. Callback owns browser version selection; the Bridge
neither enumerates versions nor reads input declarations from the artifact.
Input-contract versioning and Bridge awareness are introduced only if that
contract actually becomes incompatible, not for an ordinary CCDP version bump.

One platform configuration generates both the public profile entries and the
OAuth registrations used by the callback. The bridge advertises only
platform/version pairs supported by its selected CCDP Distribution. Selecting
a shared Distribution requires no reciprocal configuration; the effective
allowlist automatically admits its origin at this Bridge's GitHub endpoint.

## Route surface

- REQ-BRIDGE-02 (upholds SP-CCDP-01): The Bridge MUST enforce the route,
  method, and origin-admission rules below before performing route work.

The bridge exposes only:

| Method | Route | Availability | Purpose | Origin enforcement |
|---|---|---|---|---|
| `GET` | `/api/v1/ceremony/config` | always | public platform and CCDP configuration | exact `Origin` in `allowedOrigins`; absent `Origin` accepted only by the same-origin rule below |
| `GET` | `/auth/callback` | always | complete OAuth Callback document | none at HTTP ingress; callback authenticates its popup connection after clearing its input |
| `OPTIONS`, `POST` | `/api/v1/ceremony/github-token` | only when GitHub is enabled | confidential GitHub token exchange and token attestation | exact request `Origin` in `allowedOrigins`, checked on every request; exact noncredentialed CORS |

Top-level navigation may omit `Origin`, and an OAuth-platform callback may
identify the platform rather than the application. `Referer` is never an
authority input. The callback document is therefore public and
request-invariant; its browser protocol authenticates the application after it
loads.

No separate Callback script, prover, proving-asset, preparation, continuation,
polling, status, result, cancellation, browser TLS bridge, or proof-recovery
route exists on the OAuth bridge. Unsupported methods fail without route work.
Except for the OAuth-platform-mandated callback query and the GitHub JSON
request, bridge routes accept no query or request body.

The `v1` in `/api/v1/ceremony/...` versions the bridge's JSON API.
`/auth/callback` is a browser protocol document; its embedded code
selects `CCDPVersion` from OAuth `state`.
`PlatformCeremonyVersion` independently versions one platform ceremony. There
is no request-time version negotiation.

## Public configuration

- REQ-BRIDGE-03: The Bridge and Application MUST produce and validate the
  configuration record and response policy below. Necessity: each ceremony
  must freeze one mutually supported profile and Distribution.

`GET /api/v1/ceremony/config` returns `application/json` with this exact record:

```ts
interface PlatformConfig {
  clientId: string
  ceremonyVersions: readonly number[] // unsigned 16-bit integers
}

interface CeremonyConfig {
  ccdpOrigin: string
  platforms: Readonly<Record<string, PlatformConfig>>
}
```

The response rules are:

- `PlatformCeremonyVersion` is an unsigned 16-bit integer.
- `ccdpOrigin` is the configured canonical origin under the
  [origin policy](ccdp.md#origin-policy), with no credentials, path, query, or
  fragment. The Application accepts the localhost HTTP exception for this field and
  the configured Bridge origin.
- Each platform entry has one public client ID and a nonempty, duplicate-free
  list of supported ceremony versions. List order has no meaning.
- Unknown fields, malformed URLs, and unsupported numeric representations are
  invalid. A platform absent from the client's closed local catalog is ignored;
  known entries remain exact-validated before use.
- The record contains no redirect URI, secret, allowlist, artifact URL, CSP source,
  notary setting, platform display metadata, or application-specific value.

When present, `Origin` must exactly match an `allowedOrigins` member. A
successful cross-origin response sets that exact origin in
`Access-Control-Allow-Origin`, permits no credentials, and never uses `*`.
A same-origin browser GET may omit `Origin`: accept that case only when
`Sec-Fetch-Site` is `same-origin` and the Bridge's configured public origin is
itself in `allowedOrigins`. It needs no CORS response header. Do not infer
admission from `Referer`, the request host, or absent Fetch Metadata; an explicit
invalid, `null`, or unlisted `Origin` always fails.

Both cases use `Content-Type: application/json`, `Cache-Control: no-store`,
`Vary: Origin, Sec-Fetch-Site`, and `X-Content-Type-Options: nosniff`. Rejected
requests return no configuration. These browser admission checks do not make
the public record a secret from non-browser clients. Request values do not
alter the response record.

The Application fetches and validates this record without credentials. It derives `redirectUri` as
`new URL('/auth/callback', oauthBridge).href` from its validated canonical
OAuth Bridge origin, not from the response. It freezes the selected client ID,
derived redirect URI, CCDP origin, and mutually supported platform ceremony
version in each live ceremony. CCDP browser [resources](ccdp.md#documents-and-routes)
never fetch bridge configuration; server-side Callback artifact retrieval is
separate.

## Callback document

- REQ-BRIDGE-04 (upholds SP-CCDP-01): The Bridge MUST retrieve, configure, and
  serve Callback as specified below without forwarding OAuth ingress data to
  the Distribution.

`GET /auth/callback` serves Callback on the bridge origin, without
an HTTP redirect. Its [artifact contract](ccdp-distribution.md#callback-artifact)
owns the HTML, configuration slot, response policy, browser startup, version
selection, and failure UI. The bridge only:

- retrieves `{ccdpOrigin}/ccdp/callback.html` at startup and revalidates it
  independently of callback requests, rejecting upstream redirects;
- sends no callback query, OAuth return, incoming request headers, cookies, or
  credentials upstream; the configured source never depends on a request;
- validates and inserts its unversioned input list using the artifact contract,
  then publishes the completed HTML and matching response headers atomically;
- serves the cached result until a valid replacement is ready; a failed
  refresh retains the last valid result, or returns an inert unavailable
  response when none exists; and
- suppresses or redacts callback query strings throughout its ingress proxies,
  access logs, traces, analytics, metrics labels, and errors.

Compatible artifact updates require no bridge rebuild. The bridge neither
parses OAuth state nor selects a CCDP implementation, generates browser code,
or handles protocol errors. Google fragments never reach this server;
platform-mandated callback queries are not forwarded to the Distribution.

## GitHub token endpoint

- REQ-BRIDGE-05 (upholds SP-CCDP-01): The Bridge MUST enforce the exact token
  request, destination-admission, and response contract below; the Prover MUST
  validate its response before dependent identity notarization.

When GitHub is enabled, `POST /api/v1/ceremony/github-token` performs the
confidential OAuth token exchange and token MPC-TLS session synchronously. It
retains no state. The prover derives this fixed route from the origin of the
Application's frozen `redirectUri` in `ProveIdentity`; the prover document
does not embed it.

The ceremony's browser caller is Prover on `ccdpOrigin`, but this route uses the
same `allowedOrigins` rule as configuration and Callback: configured application
origins are also admitted. The requested `notaryAddress` grants no caller
admission.

The bridge API version implements GitHub ceremony version `1` only. The request
carries no ceremony-version field, and configuration must not advertise a
GitHub version requiring different token-service semantics. Such a change
requires a new bridge API version.

```ts
interface TokenRequest {
  code: string
  codeVerifier: string
  notaryAddress: string
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

`notaryAddress` follows the canonical origin rules in
[`ProveIdentity`](ccdp.md#proveidentity), including its localhost HTTP exception;
credentials, paths, queries, and fragments remain forbidden. Prover forwards the address frozen by Application and uses that same address
for identity notarization. Both sessions select the same Notary Service, but
use different transports:

- The Bridge uses native MPC-TLS over a TCP connection to the supplied host and
  the configured MPC listener port. It opens the pinned GitHub platform socket
  itself and performs the confidential token exchange jointly with the notary.
- The browser uses Proxy mode over the selected service's `/notarize-proxy`
  WebSocket for `/user`, preserving the supplied origin's scheme and effective
  port under the browser adapter's HTTPS-to-WSS or local HTTP-to-WS mapping.

The origin's scheme and HTTP port describe the browser-facing service, not the
native MPC listener. The Bridge does not derive a Proxy WebSocket or interpret
that HTTP port as its MPC port. Listener configuration selects only the native
port, not a replacement notary host or ledger profile. Failure never switches
notary or mode. Callback configuration and public `CeremonyConfig` carry no
notary selection.

This server-side destination is request-controlled. Origin/CORS checks do not
authenticate non-browser callers or replace egress controls. The Bridge must
prevent access to private/internal destinations, including through DNS
resolution, unless its operator explicitly permits the development destination.
The localhost HTTP exception removes the TLS requirement, not these egress
checks. Loopback is the Bridge's machine, which may differ from the browser's;
a development setup must make the intended notary reachable by both. Canonical
origin syntax alone is insufficient; redirects remain forbidden.

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
the response encoding, correlation, and open request bindings. Neither Prover
nor Application performs local notary-signature verification. A structurally valid
forged signature is not detected by these checks alone; downstream verification
of the original bytes against trusted notary keys remains authoritative and
mandatory.

The endpoint contract is:

- the query is empty and the request media type is exactly `application/json`;
- every preflight and POST carries one valid `Origin` exactly matching an
  `allowedOrigins` member; missing, `null`, malformed, multiple, or unlisted origins
  reject before notary resolution, connection, or token exchange. Successful
  preflight never substitutes for checking the actual POST;
- successful preflight admits only `POST` and `Content-Type`, uses no
  credentials, and returns no ceremony data;
- malformed UTF-8, JSON, or fields fail before token exchange;
- client ID, client secret, and the GitHub TLS/request target come only from
  bridge configuration; `redirect_uri` is derived from the configured Bridge
  origin and fixed `/auth/callback` path. Only the notary destination comes from
  the validated request above;
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

- REQ-BRIDGE-06: The Bridge MUST preserve the public API version's semantics
  when refreshing compatible Callback artifacts. Necessity: CCDP version
  selection must not silently change the confidential exchange contract.

A breaking JSON request or response changes the bridge API version. CCDP,
platform ceremony, prover release, and popup connection versions remain
independent; the [CCDP version rules](ccdp.md#paths-and-versioning) do not
version the Bridge's API.

## Security Considerations

The Bridge participates in SP-CCDP-01 under ASM-CCDP-01 and ASM-CCDP-02.
Its operator supplies the OAuth registrations, confidential client secret, and
Callback deployment policy. Its code and deployment are trusted for correct
browser code delivery and credential handling, not for ledger acceptance.

CORS and Origin checks protect browser admission, not non-browser
authentication. The request-selected notary address therefore retains the
egress restrictions above. A notary URL is a routing choice, never authority to
select a trusted attestation key. Confidential token exchange is the irreversible
boundary: denial, timeout, or response loss cannot unspend an OAuth code.

Structural and commitment checks do not authenticate notary signatures.
A forged but structurally consistent result can reach proof generation; the
Ledger Verifier still authenticates the original signed bytes against its trusted
keys. Common and platform ceremony rules own that verification and all replay,
freshness, and proof-soundness properties.

## Conformance

A Bridge implements configuration and Callback; its GitHub route is required
only when that platform is enabled. These tests cover the HTTP boundary, not
cryptographic soundness.

- TEST-BRIDGE-01 (exercises REQ-BRIDGE-01):
  Default Distribution origin is added once; a replacement is added instead. Invalid/duplicate configured origins fail, and HTTP loopback works at any port.
- TEST-BRIDGE-02 (exercises REQ-BRIDGE-02):
  Disallowed and missing origins reject according to each route's rules before dependency work; explicit bad Origin cannot use the same-origin GET exception.
- TEST-BRIDGE-03 (exercises REQ-BRIDGE-03):
  Exact public config has no redirect field, secrets, or notary selection; malformed known profiles reject and unknown platforms are ignored.
- TEST-BRIDGE-04 (exercises REQ-BRIDGE-04):
  Callback queries/cookies/headers never reach the artifact request; failed refresh preserves the last valid HTML/policy pair, or serves inert unavailability.
- TEST-BRIDGE-05 (exercises REQ-BRIDGE-05):
  Actual POST origin is checked after preflight; malformed JSON, oversize token, bad canonical bytes, forbidden notary destination, and mismatched opening reject. Native MPC uses the requested host and configured listener port, not Proxy transport.
- TEST-BRIDGE-06 (exercises REQ-BRIDGE-06):
  Compatible bundled Callback updates need no Bridge rebuild; unsupported browser versions fail locally and do not change the Bridge API version.
