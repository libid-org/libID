# OAuth Bridge Server

This document defines the HTTP and deployment contract for the OAuth bridge
used by CCDP. The bridge publishes platform
configuration and serves the OAuth callback document.

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

- OAuth application registrations and their public client configuration;
- the public ceremony configuration; and
- callback ingress, response policy, and deployment inputs.

For Callback, the bridge is a configuration-inserting, cached proxy to the
[CCDP Distribution](ccdp-distribution.md#callback-artifact). It neither
implements the document nor requires a TypeScript build. It serves no other
CCDP resources. The browser-exchange profiles covered here require no Bridge
ceremony state, token exchange, or notarization.

Bridge-assisted OAuth is a platform-profile choice, not prohibited by CCDP.
Another platform or later ceremony version can define a Bridge service together
with its HTTP contract, credential custody, and trust/evidence requirements.
The route surface below requires no such service for the browser-exchange
profiles; it does not preclude one where a profile requires it.

The bridge and Distribution may be cross-site and independently operated;
both are code-supply-chain trust boundaries. The Distribution requires no
Bridge registration and receives no application allowlists.

## Deployment configuration

- REQ-BRIDGE-01 (upholds SP-CCDP-01): The Bridge MUST derive its effective
  origin allowlist and Callback inputs from the deployment configuration below,
  not incoming requests.

One bridge deployment has these inputs. Every origin follows the
[CCDP origin policy](ccdp.md#origin-policy), including HTTP on exact
`localhost` and `127.0.0.1` hosts:

| Input | Contract |
|---|---|
| `allowedAppOrigins` | Nonempty, duplicate-free set of canonical application origins admitted by the bridge |
| CCDP origin | One canonical origin selected by the operator; defaults to `https://lib.id` when omitted |
| Platform profiles | Public OAuth client ID, supported ceremony versions, and an optional public `clientCredential` for each enabled platform |
| Callback inputs | One unversioned list `[allowedOrigins, ccdpOrigin]` derived from the values above, plus deployment-policy sources required by the [artifact contract](ccdp-distribution.md#configuration-insertion); no separate input configuration or CCDP version list |

Every enabled platform's OAuth registration uses `/auth/callback` on the
externally reachable Bridge origin as its `redirect_uri`. The path is fixed,
not a deployment option. The operator registers that external URL with the
platform; the Bridge process requires neither its own public-origin setting nor
a redirect URI. Application-side redirect construction is defined below.

`allowedAppOrigins` has no protocol maximum. A duplicate or invalid member is a
deployment error rather than something the bridge normalizes. After resolving
the default or configured `ccdpOrigin`, the bridge derives one effective set:
`allowedOrigins = allowedAppOrigins ∪ {ccdpOrigin}`. Adding an already-listed
CCDP origin does not duplicate it. When `ccdpOrigin` is omitted, this adds
`https://lib.id`; when overridden, only the replacement is added automatically.
`https://lib.id` then remains allowed only if explicitly listed.

The effective set governs explicit `Origin` admission for configuration GET
and all callback connection authentication. Configuration GET also admits the
same-origin browser case defined below. The set is embedded into Callback, not
separately configured, and never inferred from a request's `Origin`, `Referer`,
query, fragment, or body.

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

The public profile entries match the OAuth registrations used by Callback.
The bridge advertises only platform/version pairs supported by its selected
CCDP Distribution. Selecting a shared Distribution requires no reciprocal
configuration.

## Route surface

- REQ-BRIDGE-02 (upholds SP-CCDP-01): The Bridge MUST enforce the route,
  method, and origin-admission rules below before performing route work.

For the profiles covered here, the bridge exposes only:

| Method | Route | Availability | Purpose | Origin enforcement |
|---|---|---|---|---|
| `GET` | `/api/v1/ceremony/config` | always | public platform and CCDP configuration | exact `Origin` in `allowedOrigins`; absent `Origin` accepted only by the same-origin rule below |
| `GET` | `/auth/callback` | always | complete OAuth Callback document | none at HTTP ingress; callback authenticates its popup connection after clearing its input |

Top-level navigation may omit `Origin`, and an OAuth-platform callback may
identify the platform rather than the application. `Referer` is never an
authority input. The callback document is therefore public and
request-invariant; its browser protocol authenticates the application after it
loads.

For these profiles, no separate Callback script, prover, proving-asset,
preparation, continuation, polling, status, result, cancellation, token-exchange,
notarization, browser TLS bridge, or proof-recovery route exists on the OAuth
bridge. Unsupported methods fail without route work.
Except for the OAuth-platform-mandated callback query, bridge routes accept
no query or request body.

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
  clientCredential?: string
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
  fragment. The Application accepts the localhost HTTP exception for this field
  and the Bridge origin it uses.
- Each platform entry has one public client ID and a nonempty, duplicate-free
  list of supported ceremony versions. List order has no meaning.
- `clientCredential`, when present, is a nonempty printable ASCII string
  without whitespace. It is an intentionally public OAuth application credential,
  not a user access token. GitHub requires it and uses it as `client_secret`;
  other profiles omit it unless their token exchange needs one. Missing required
  credentials, null, empty, or wrongly typed values are invalid. The selected
  platform owns any additional constraints.
- Unknown fields, malformed URLs, and unsupported numeric representations are
  invalid. A platform absent from the client's closed local catalog is ignored;
  known entries remain exact-validated before use.
- The record contains no redirect URI, confidential credential, user token,
  allowlist, artifact URL, CSP source, notary setting, platform display metadata,
  or application-specific value.

When present, `Origin` must exactly match an `allowedOrigins` member. A
successful cross-origin response sets that exact origin in
`Access-Control-Allow-Origin`, permits no credentials, and never uses `*`.
A same-origin browser GET may omit `Origin`: accept that case only when
`Sec-Fetch-Site` is exactly `same-origin`. This browser-supplied relationship
requires neither knowledge of the Bridge's public origin nor its membership in
`allowedOrigins`; the response needs no CORS header. Missing or other
`Sec-Fetch-Site` values reject this absent-Origin case. Do not infer admission from
`Referer`, `Host`, or forwarding headers; an explicit invalid, `null`, or
unlisted `Origin` always fails, even with `Sec-Fetch-Site: same-origin`.
This exception admits only the public, read-only configuration response; it
does not change Callback's connection allowlist.

Both cases use `Content-Type: application/json`, `Cache-Control: no-store`,
`Vary: Origin, Sec-Fetch-Site`, and `X-Content-Type-Options: nosniff`. Rejected
requests return no configuration. These browser admission checks do not make
the public record a secret from non-browser clients. Request values do not
alter the response record.

The Application fetches and validates this record without credentials. It derives `redirectUri` as
`new URL('/auth/callback', oauthBridge).href` from its validated canonical
OAuth Bridge origin, not from the response. It freezes the selected client ID,
public token-exchange credential when present, derived redirect URI, CCDP origin,
and mutually supported platform ceremony version in each live ceremony. It
forwards the credential unchanged through CCDP's `ProveIdentity`; a configuration
refresh does not replace it in a live ceremony.
CCDP browser [resources](ccdp.md#documents-and-routes)
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

- REQ-BRIDGE-05: Withdrawn.

This GitHub profile requires no Bridge token endpoint. Prover performs the
exchange and notarization; the [platform profile](platform-ceremonies.md#6-github-ceremony)
owns their semantics.

## Compatibility

- REQ-BRIDGE-06: The Bridge MUST preserve the public API version's semantics
  when refreshing compatible Callback artifacts. Necessity: a browser artifact
  refresh must not silently change the public configuration contract.

A breaking JSON request or response changes the bridge API version. CCDP,
platform ceremony, prover release, and popup connection versions remain
independent; the [CCDP version rules](ccdp.md#paths-and-versioning) do not
version the Bridge's API.

## Security Considerations

The Bridge participates in SP-CCDP-01 under ASM-CCDP-01 and ASM-CCDP-02.
Its operator supplies OAuth registrations, public application credentials, and
Callback deployment policy. Its code and deployment are trusted for correct
browser code delivery and configuration, not for ledger acceptance.

CORS and Origin checks protect browser admission, not non-browser
authentication or confidentiality of the configuration. The public
`clientCredential` carries no user authority and is not an application
authentication boundary. Platform ceremony rules own the consequences of
publishing it and the downstream checks; renaming the field does not hide it.
For these profiles, the Bridge receives no notary address and opens no token or
notary connection.
Callback query redaction remains necessary because OAuth codes, unlike public
application credentials, are transient user-ceremony inputs.

## Conformance

A Bridge implements configuration and Callback for every enabled platform.
These tests cover the HTTP boundary, not
cryptographic soundness.

- TEST-BRIDGE-01 (exercises REQ-BRIDGE-01):
  Default Distribution origin is added once; a replacement is added instead. Invalid/duplicate configured origins fail, and HTTP loopback works at any port.
  Configuration and Callback work without a server public-origin or redirect-URI
  setting; the Application derives the fixed callback URL from its Bridge origin.
- TEST-BRIDGE-02 (exercises REQ-BRIDGE-02):
  A configuration GET without Origin succeeds with exactly
  `Sec-Fetch-Site: same-origin`, even when the Bridge origin is not allowlisted;
  missing, `same-site`, `cross-site`, `none`, or malformed Fetch Metadata reject
  that case. An allowed explicit Origin succeeds even with cross-site metadata;
  an invalid, `null`, or unlisted Origin rejects even with same-origin metadata.
  Rejections occur before dependency work; accepted same-origin GET does not
  admit an otherwise unlisted Application to Callback.
  For the browser-exchange profiles, the former token route performs no exchange
  or notary work, including on POST.
- TEST-BRIDGE-03 (exercises REQ-BRIDGE-03):
  Exact public config includes GitHub's public token-exchange credential and has
  no redirect field, user token, or notary selection. Missing required, empty,
  null, wrongly typed, or whitespace/control-bearing credentials reject;
  malformed known profiles reject and unknown platforms are ignored. Application
  freezes the credential and forwards the same value to Prover despite later
  configuration changes.
- TEST-BRIDGE-04 (exercises REQ-BRIDGE-04):
  Callback queries/cookies/headers never reach the artifact request; failed refresh preserves the last valid HTML/policy pair, or serves inert unavailability.
- TEST-BRIDGE-05: Withdrawn.
- TEST-BRIDGE-06 (exercises REQ-BRIDGE-06):
  Compatible bundled Callback updates need no Bridge rebuild; unsupported browser versions fail locally and do not change the Bridge API version.
