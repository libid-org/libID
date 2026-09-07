# Ceremony client

Owns one-time Bridge configuration, frozen ceremony construction and the one-shot
Application lifecycle over a caller-supplied `PopupConnection`.

- [Client API and lifecycle](docs/client.md): construction, results, cancellation and progress.
- [Public configuration](../../docs/oauth-bridge.md#public-configuration): Bridge response contract.
- [CCDP protocol](../ccdp/docs/protocol.md): messages and ordering.

[config.ts](config.ts) validates configuration; [ceremony.ts](ceremony.ts) owns state
and handlers. Identity extraction stays in the platform Provers. Wallet operations,
submission and post-ceremony actions belong to the Application.
