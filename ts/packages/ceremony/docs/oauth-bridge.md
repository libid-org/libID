# OAuth Bridge Server

Local development exception: references to HTTPS Bridge, CCDP, application and
notary URLs below also admit canonical HTTP URLs on exactly `localhost` or
`127.0.0.1`. A local HTTP notary uses WS at the same authority. This exception does
not apply to OAuth provider requests or external proving assets. COOP/COEP, origin
admission, callback privacy and all other validation remain required. LAN addresses,
lookalike domains and noncanonical spellings are not admitted.

This document defines the HTTP and deployment contract for the OAuth bridge
used by `@libid/ceremony`. The bridge publishes platform
configuration, serves the OAuth callback document, and performs the one
confidential platform exchange required by GitHub.

The package API is defined in [ARCHITECTURE.md](architecture.md), the callback
participant in [CCDP](documents.md#callback-get-redirecturi), and proof generation in
[PROVING.md](proving.md). The normative libID specification owns authorization,
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

For Callback, the bridge is a configuration-inserting, cached proxy to the
[CCDP Distribution](distribution.md#callback-artifact). It neither
implements the document nor requires a TypeScript build. It serves no other
CCDP resources and stores no ceremony state. Google and X require no
confidential bridge route.

The bridge and Distribution may be cross-site and independently operated;
both are code-supply-chain trust boundaries. The Distribution requires no
Bridge registration and receives no application allowlists.

## Deployment configuration

One bridge deployment has these inputs:

| Input | Contract |
|---|---|
| Bridge origin | Canonical HTTPS origin used by every bridge route and the configured OAuth redirect URI; explicit loopback development is the only HTTP exception |
| `allowedAppOrigins` | Nonempty, duplicate-free set of canonical HTTPS application origins admitted by the bridge |
| CCDP origin | One canonical HTTPS origin selected by the operator; defaults to `https://lib.id` when omitted |
| Callback path | Developer-configurable fixed path whose default is `/auth/callback`; registered as every enabled platform's OAuth `redirect_uri` |
| Platform profiles | Public OAuth client ID and supported ceremony versions for each enabled platform |
| Callback inputs | One unversioned list `[allowedOrigins, ccdpOrigin]` derived from the values above, plus deployment-policy sources required by the [artifact contract](distribution.md#configuration-insertion); no separate input configuration or CCDP version list |
| GitHub settings | Client secret, redirect URI, and token endpoint settings when GitHub is enabled |

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

The bridge exposes only:

| Method | Route | Availability | Purpose | Origin enforcement |
|---|---|---|---|---|
| `GET` | `/api/v1/ceremony/config` | always | public platform and CCDP configuration | exact `Origin` in `allowedOrigins`; absent `Origin` accepted only by the same-origin rule below |
| `GET` | configured callback path, default `/auth/callback` | always | complete OAuth Callback document | none at HTTP ingress; callback authenticates its popup connection after clearing its input |
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
The configured callback path is a browser protocol document; its embedded code
selects `CCDPVersion` from OAuth `state`.
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
- The record contains no secret, allowlist, artifact URL, CSP source,
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

The application-scoped `CeremonyClient` fetches and validates this record once
at creation using `credentials: 'omit'`. It freezes the selected client ID,
redirect URI, CCDP origin, and mutually supported platform ceremony version
in each live ceremony. CCDP browser [resources](documents.md#documents-and-routes)
never fetch bridge configuration; server-side Callback artifact retrieval is
separate.

## Callback document

The registered `redirect_uri` serves Callback on the bridge origin, without
an HTTP redirect. Its [artifact contract](distribution.md#callback-artifact)
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

When GitHub is enabled, `POST /api/v1/ceremony/github-token` performs the
confidential OAuth token exchange and token TLSNotary session synchronously. It
retains no state. The prover derives this fixed route from the origin of the
Ceremony Client's frozen `redirectUri` in `AppStartProver`; the prover document
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

`notaryAddress` is a required canonical HTTPS origin with no credentials, path,
query, or fragment. Prover forwards the address already
[snapshotted by CeremonyClient](client.md#notary-selection) from the
supplied ledger, and uses that same address for identity notarization. The Bridge
derives the fixed `/notarize-proxy` WebSocket endpoint from it; it neither
classifies ledgers nor maintains a notary mapping or override.
Failure never selects a different notary. Callback configuration and public
`CeremonyConfig` carry no notary selection.

This server-side destination is request-controlled. Origin/CORS checks do not
authenticate non-browser callers or replace egress controls. The Bridge must
prevent access to private/internal destinations, including through DNS
resolution, unless its operator explicitly permits the development destination.
Canonical HTTPS syntax alone is insufficient; redirects remain forbidden.

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
nor Client performs local notary-signature verification. A structurally valid
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
- client ID, client secret, redirect URI, and the GitHub TLS/request target
  come only from bridge configuration; only the notary destination comes from
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

A breaking JSON request or response changes the bridge API version. CCDP,
platform ceremony, prover release, and popup connection versions remain
independent as defined in
[ARCHITECTURE.md](architecture.md#versioning-and-compatibility).
