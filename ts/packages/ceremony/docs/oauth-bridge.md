# OAuth Bridge integration

The normative [OAuth Bridge contract](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/oauth-bridge.md) owns routes,
admission, configuration, and token request/response semantics. Ceremony supplies
a browser client and static Callback artifact, not a production Bridge server.
[The shared development app](../../../apps/dev/README.md) owns the runnable stack.

## Current Bridge integration

The development stack pins Bridge PR #10 at
`cdc16551114070ea3458ef0d5ceb19ca4228833e`, on PR #9 at
`991d5c604acdb1a67099f28cbf37ad58b6c317a5`. It uses libid-rs v0.4.0 and the
TLSN/MPZ revisions matched to notary v0.3.0-rc.3.
[Qualification](qualification.md) records what was exercised.

The current wire differs from the fixed-callback specification in two linked
places: config includes `callbackPath`, and GitHub's token request includes
`redirectUri`. Client validates the path and freezes the resolved URI once;
the GitHub adapter forwards that same value and checks it in the returned
attestation. Removing both fields requires the coordinated Bridge migration
tracked in [pending updates](qualification.md#pending-contract-updates). It is
intentionally not implemented by this documentation reconciliation.

The Bridge's TOML platform tables supply client IDs and versions. It retrieves
the complete Callback artifact before listening and inserts deployment data
into its non-executable slot. The [distribution build](distribution.md) owns
the bundled Callback code and generated executable hashes.

## Notary and token exchange

Client snapshots `LedgerId.notaryAddress()` before OAuth. The GitHub adapter
sends that origin in its token request and uses the same notary for identity
notarization. The Bridge uses the requested host with its configured native
MPC-TLS TCP listener port, not the origin's HTTP port and not a Proxy WebSocket.
The browser identity session uses `/notarize-proxy` over WSS, or WS for permitted
HTTP loopback. This is the intended mode split, not an implementation deviation.

The [GitHub adapter](../src/platforms/github/1/prover.ts) checks canonical JSON
and byte encodings, token bounds, attestation structure, request bindings, and
opening correlation before its dependent identity request. It does not verify
notary signatures locally. The response remains one correlated result; it has
no polling or recovery record.

Bridge origin admission is checked on every actual request, independently of
preflight. DNS/egress controls remain server-owned: CORS is not authentication
of non-browser clients. The loopback exception does not waive those controls.
Production egress and refresh behavior require the external qualification
recorded in the [qualification guide](qualification.md).
