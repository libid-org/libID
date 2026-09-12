# CCDP implementation

The [CCDP specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/ccdp.md) owns documents, private navigation
inputs, messages, core events, ordering, and terminal outcomes. This guide owns
only their TypeScript implementation. [Qualification](qualification.md#pending-contract-updates)
records the two outstanding coordinated contract updates; the protocol is not
silently redefined here to match them.

## Implementation guide

[index.ts](../src/ccdp/index.ts) defines five message interfaces and same-named
decoder companions. This internal, browser-free leaf is shared by Client and
the document entrypoints; it has no public package subpath and imports no
platform execution code.

A shared `assertMessage` checks the plain record, discriminator, and exact field
set. A companion checks its own field types and bounds and returns the received
record, without coercion, defaults, field stripping, or another allocation.
`IdentityProof.proof` remains opaque here: the selected platform/version's
validator owns its structure. This lets a platform be added without adding a
protocol message or importing its proving runtime into Client.

The supplied popup connection dispatches by the registered companion and decodes
once. Handlers in [Client](client.md) and [documents](documents.md) enforce
direction, cardinality, and state; a structural decoder does not authorize a
transition. No global registration, aggregate runtime decoder, or second
authentication handshake is needed.

[navigation.ts](../src/ccdp/navigation.ts) owns versioned route construction,
state routing, and exact fragment codecs. It preserves the two OAuth URL
components separately through one outer encoding layer. Location clearing and
popup connection setup belong to the document entrypoints.

## Events and outcomes

[events.ts](../src/events.ts) supplies one local operation feed. Document code
forwards its observations using the Event companion, and Client merges remote
and local observations. Core readiness is handled before subscribers; optional
observers and exporters cannot suppress it.

Client alone accepts the final proof structure and produces the completed
outcome. Denial, cancellation, and failure terminate without fabricating an
operation finish. [Client subscriptions](client.md#progress-cancellation-and-recovery)
and [measurements](metrics.md) describe UI projections and the export boundary;
they are not extra wire messages.

[errors.ts](../src/errors.ts) preserves bounded opaque error text and local causes.
The wire carries only the event name and display text. This is useful debugging
context, not a credential-redaction guarantee; exporters omit it. Undeliverable
reports use a fixed local diagnostic.
