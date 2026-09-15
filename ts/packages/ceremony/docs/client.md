# Client guide

Create one client per Bridge configuration lifetime. It fetches public
configuration once; create a new client to pick up a changed deployment.
The application must also know its intended CCDP origin to configure popup's
origin allowlist.

## Launch a ceremony

This example connects an existing anchor and status element. Call it during
application setup, then let the user click the anchor. Supply the application's
ledger, 32-byte operation-domain hash and opaque transaction bytes.

```ts
import { CeremonyStage, createCCDPClient } from '@libid/ceremony/ccdp/client'
import type { LedgerId } from '@libid/ledger'
import { PopupConnection, PopupWindow } from '@libid/popup'

async function bindGoogleAction(
  anchor: HTMLAnchorElement,
  status: HTMLElement,
  ledger: LedgerId,
  operationDomain: Uint8Array,
  transactionData: Uint8Array,
) {
  const bridgeOrigin = 'https://bridge.example'
  const ccdpOrigin = 'https://proofs.example'
  const client = await createCCDPClient({ oauthBridge: bridgeOrigin })

  anchor.addEventListener('click', (event) => {
    const id = crypto.randomUUID()
    const target = `ceremony-${id}`
    // Keep window creation synchronous with the user's activation.
    const popup = PopupWindow.open(target)
    const connection = PopupConnection.connect(popup, {
      connectionId: id,
      allowedPopupOrigins: [bridgeOrigin, ccdpOrigin],
    })
    try {
      const ceremony = client.new(
        connection, id, 'google', ledger, operationDomain, transactionData,
      )
      anchor.target = target
      anchor.href = ceremony.launchUrl
      if (popup.opened) event.preventDefault() // Otherwise let the real anchor launch.
      const off = ceremony.onStage((update) => {
        status.textContent = update.status === 'active'
          ? CeremonyStage.message(update.stage, 'Google')
          : update.message ?? update.status
      })
      void ceremony.proveUserIdentity().then(
        (result) => {
          if (result.status === 'accepted') {
            // Hand result.identity and result.oauthProof to your ledger adapter,
            // together with the original operation inputs.
          }
          connection.close() // This application closes on acceptance or denial.
        },
        (error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'Ceremony failed.'
          // Keep this application's failed popup available for inspection.
        },
      ).finally(off)
    } catch (error) {
      event.preventDefault()
      connection.close()
      status.textContent = error instanceof Error ? error.message : 'Unable to start ceremony.'
    }
  })
}
```

The [development app](../../../apps/dev/src/app.ts) shows platform buttons,
concurrent runs, independent Close controls and timing history. Each live run
needs its own target, connection and fresh lowercase UUIDv4. Use the same UUID
for popup's `connectionId` and `client.new`'s ceremony ID. Reserve no CCDP message
handlers yourself on that connection.

`new(connection, id, platformId, ledger, operationDomain, transactionData, version?)`
is synchronous and snapshots its inputs before OAuth. It reads `ledger.hash()`
and `ledger.notaryAddress()` once, copies the hash and byte inputs, and derives
fresh authorization material. Invalid selection, ledger values or inputs fail
before OAuth. A client cannot reuse a live ID; a connection cannot run two
ceremonies simultaneously. Full signatures and lifecycle JSDoc live in
[ceremony.ts](../src/ccdp/client/ceremony.ts).

`launchUrl` is the complete Prefetch URL for a native anchor.
`proveUserIdentity()` starts the run once and owns subsequent protocol navigation.
Raw OAuth returns stay inside Callback and Prover; the application receives
neither them nor bearer credentials or private witnesses.

## Platform and version discovery

- `client.enabledPlatforms`: frozen compatible platform IDs for this Bridge.
- `client.enabledVersions(platform)`: compatible versions in ascending order;
  empty for a known disabled platform.
- `supportedPlatforms`, exported from either entrypoint: package capabilities
  before fetching configuration. It does not establish Bridge availability.

`PlatformId` is derived from the closed catalog (`google`, `x`, `github`). Display
names and icons belong to the application. Only ceremony version 1 currently
exists. An omitted version chooses the highest compatible one; pass the trailing
version argument explicitly when selecting a particular disclosure behavior.
Unsupported selections fail synchronously without starting OAuth.

Client derives fixed `/auth/callback` from its configured Bridge origin; public
configuration contains no callback path or redirect URI.

GitHub configuration must include `clientCredential`, a nonempty printable
ASCII public OAuth application credential without whitespace. Client freezes and
forwards it unchanged in `ProveIdentity`; Prover never refetches configuration.
The field is optional for other platforms and validated whenever present. There
is no per-ceremony credential override.

## Ledger and notary inputs

[`@libid/ledger`](../../ledger/README.md) owns the ledger interface. Production
ledger definitions are still deferred; the dev app uses an explicit synthetic
fixture. Ceremony includes no chain catalog, EVM adapter or ledger decoder.

Client forwards the ledger's notary address for every platform. Google ignores
it; X and GitHub require it before notarized work. There is no client override,
environment lookup or automatic notary substitution. The address selects routing,
not a trusted signing key. Downstream verification establishes notary authority.

Bridge, CCDP and notary origins must be canonical HTTPS origins, with HTTP
allowed on exactly `localhost` and `127.0.0.1` at arbitrary ports. Credentials,
paths, query strings and fragments are not origins. The HTTP exception does not
relax platform HTTPS or the Prover's isolation requirement.

## Results and errors

Popup transport failure reports `failed`, including a window that becomes
unavailable during consent without a recovery carrier. The error explains that
closure and provider isolation (COOP) cannot be distinguished. An available
fallback keeps the ceremony pending until reconnection, fallback failure, or
explicit application closure. This does not alter OAuth denial handling.

Application ending its connection cannot stop a provider page after opener
severance. On return, Callback and Prover display their own connection failures
locally, stop the progress indicator and further work, and preserve the transport
error rather than replacing it with a generic closure message. The user can
return to Application and start a new ceremony. No successful report back to
Application is required; an undeliverable failure leaves only the sanitized local
diagnostic. This identifies a connection/setup failure, not which component
caused it.

[CCDP UI messages](../src/ccdp/ui-messages.ts) groups stage labels, document UI text,
error-page text, and translations of popup error codes. Popup returns programmatic
errors; ceremony translates them before display or forwarding. Unexpected
exceptions retain their bounded opaque text for debugging.

`proveUserIdentity()` resolves either `{ status: 'denied' }` or an accepted result
containing separate `identity` and `oauthProof` values:

- `identity`: exact platform ID, OAuth client ID, user ID and user name. The name
  is Google's signed email, X's username or GitHub's login, without normalization.
- `oauthProof`: selected `platformCeremonyVersion`, fresh `authorizationNonce`
  and the platform-specific `proof`.

Google's proof contains `identityProof`, `tokenExpiresAt` and
`signingKeyModulus`. X/GitHub contain `bearerLinkProof`, `tokenAttestation` and
`identityAttestation`. A `NotaryAttestation` preserves original `attestedData`
and `signature` bytes with the Prover's complete `decoded` convenience view.
Use `OAuthProof<'google'>['proof']`, for example, to name a payload type without
importing private modules. A literal platform argument infers its result type;
a dynamic `PlatformId` produces the corresponding union.

**Accepted means structurally accepted, not cryptographically verified.** Client
checks the selected platform/version, exact shapes, bounds and OAuth client ID.
It does not repeat evidence parsing, authenticate decoded views, verify notary
signatures or verify ZK proofs. The ledger adapter must preserve signed bytes
and combine the result with the original operation inputs; convenience views
are not authoritative ledger evidence.

Technical failure and connection loss reject with `CeremonyError`, carrying
`event` (operation context), bounded opaque `message`, and `status`:
`'failed'` for technical failures or `'closed'` for a reported connection closure.
Closure emits a neutral interruption through both subscriptions and rejects the
pending operation; it is not OAuth denial. Popup detection remains best-effort,
including after opener severance. Closure after an accepted result or denial
cannot overwrite that terminal outcome. Display text with
`textContent`; do not interpret it as a stable error code or export it as
telemetry. A caught dependency message is not guaranteed free of sensitive data.
An OAuth denial resolves normally; closing a consent page without a valid denial
return does not imply denial.

## Events and presentation

Subscribe before starting; subscriptions do not replay past observations.
`onEvent` combines local and received operation occurrences into one timeline.
Active events have `event`, optional `phase`, `timestamp` and optional
`instrumentation`. Client derives exactly one terminal lifecycle update before
the promise settles. Status is `active | completed | denied | failed | closed`.
Only accepted proof delivery produces `prover.finished` with `completed` status;
early outcomes do not fabricate a finished operation.

`onStage` provides a sequential UI projection, including terminal status and
failure text, so a simple UI needs only this subscription:

| Stage | Trigger |
|---|---|
| `preparation` | Prefetch dispatch starts. |
| `authorization` | Provider navigation starts. |
| `proof-preparation` | Authorization return, or Prover readiness if that observation was lost. |
| `notarization` | Token fetch or token attestation starts; Google skips it. |
| `zk-proving` | ZK generation starts. |

Use `CeremonyStage.message(stage, platformName)` for package wording. Stages
never move backwards and do not represent exclusive execution intervals or
percentages. ZK generation may finish while attestations remain pending.
[Measurements](metrics.md) explains occurrence timestamps and timing limits.
Observers can throw or unsubscribe without disrupting protocol processing.

## Closure and retries

Ceremony never closes the supplied connection, including after success or denial.
The example chooses automatic closure; an application may instead continue its
own flow in the popup. Late CCDP traffic becomes inert after settlement.

To stop a live run, call `connection.close()`. This causes a failed lifecycle
update and `CeremonyError`, not an OAuth denial, cancel message or `CancelError`.
An application wanting a separate cancellation label records its own intent.
Closing the popup cannot recall a request already dispatched to the Bridge.

A Ceremony is one-shot. Loss, reload or retry requires fresh OAuth and a new
ceremony ID; there is no resume API. Discard subscriptions when the consuming
view is removed. Optional opener-independent fallback requires matching popup
adapters in the application and [distribution build](distribution.md#bridge-and-popup-integration).
