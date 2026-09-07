# Browser notarization

Shared TLSNotary adapter for X and GitHub: exact HTTP requests, bounded transcripts,
selective disclosures and correlation with canonical final attestations.

- [Notarization contract](docs/notarization.md): session lifecycle, wire encoding and disclosure rules.
- [Platform pipelines](../../platforms/docs/pipelines.md): token/identity overlap and delivery dependencies.
- [Qualification blockers](../../../docs/qualification.md#actual-blockers-and-unqualified-boundaries): matched service, timing and profile gaps.

[session.ts](session.ts) controls a dedicated [session.worker.ts](session.worker.ts).
[transport.ts](transport.ts) frames final output, [decode.ts](decode.ts) reads canonical
attested bytes, and [notarize.ts](notarize.ts) correlates transcripts and openings.
Original attestations and signatures are preserved; local signature verification is
outside the adapter's responsibility.

[notary.ts](../notary.ts) selects one build-owned notary address from the decoded
ledger. X uses it for both sessions; GitHub sends it unchanged to the Bridge and
uses it for the browser identity session. The ledger package contains no endpoints.
