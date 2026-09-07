# Ceremony Cross-Document Protocol

Pure message types, decoder companions and navigation encodings shared by the Client
and document entrypoints. The public `@libid/ceremony/ccdp` export stays browser-free.

- [Protocol contract](docs/protocol.md): actors, messages, ordering and terminal outcomes.
- [Documents](documents/README.md): Callback, Prefetch and Prover entrypoints.
- [Routes and fragments](documents/docs/documents.md): versioned locations and private handoff.

[index.ts](index.ts) defines the seven message companions. [navigation.ts](navigation.ts)
owns fragment codecs and state routing. `@libid/popup` supplies authenticated delivery,
window lifecycle and continuity; CCDP owns no carrier implementation.
