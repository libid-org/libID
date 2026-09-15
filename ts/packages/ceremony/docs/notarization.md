# Browser notarization

The [notary module](../src/notary/) adapts the pinned TLSNotary WASM Proxy API.
Platform code owns exact requests, response parsing and disclosure selection;
the adapter owns sessions, transcript bounds, final-frame delivery and correlation.
The [platform specification](https://github.com/libid-org/libid/blob/docs/ceremony-browser-architecture/specs/platform-ceremonies.md)
owns authoritative request/evidence rules.

## Session lifecycle

[Notarization](../src/notary/session.ts) owns one WASM runtime/thread pool per
ceremony. Each `prepare(url)` creates a separate TLS session and WebSocket.
Preparation needs a fixed HTTPS target but no bearer, so independent sessions
can prepare concurrently.

| Operation | Available output |
|---|---|
| `prepare(url)` | One prepared session bound to that exact URL. |
| `session.send(request)` | Original sent/received transcript after one request. |
| `session.reveal(ranges)` | Private commitment openings and a pending `attestation` promise. |
| `await result.attestation` | Complete decoded and correlated final attestation. |

Transcript parsing and witness construction can use early material while final
attestations remain pending. That material is provisional: delivery must join
all final attestations and the generated proof. A late failure discards the
speculative result. See [X/GitHub scheduling](pipelines.md).

The supplied abort signal releases the shared worker, including idle prepared
sessions. Any session failure aborts sibling work. Successful sessions release
their own prover/channel; the platform's `finally` abort releases the shared
runtime. Types and exact method constraints stay beside the implementation.

## Transport and bounds

The adapter receives the client's frozen notary origin. HTTPS maps to WSS
`/notarize-proxy`; allowed loopback HTTP maps to WS. Platform requests remain
HTTPS. There is no session-creation HTTP request, polling endpoint, alternate
notary selection or browser notary-key lookup.

[session.worker.ts](../src/notary/session.worker.ts) overlaps socket connection
with shared WASM initialization, then performs target-specific TLS setup.
After TLSNotary finishes, it reclaims the same channel for one length-prefixed
JSON attestation frame and requires EOF. [transport.ts](../src/notary/transport.ts)
owns frame bounds and exact decoding. The separate finalization deadline prevents
an unfinished frame/close from retaining a worker indefinitely; it does not
establish X's authorization-code deadline.

The adapter admits at most 4 KiB sent and 32 KiB received transcript bytes before
exposing them to parsing/reveal. These are post-receive acceptance limits: the
pinned Proxy runtime does not enforce the supplied setup limits as reception
memory/network caps. Keep that limitation explicit when qualifying resource use.

## Evidence handling

[notarize.ts](../src/notary/notarize.ts) validates selected ranges, merges adjacent
reveals as TLSNotary does, and commits the complement. It correlates private
openings, transcript lengths, reveals and commitments with final attested bytes.
Missing coverage, wrong framing or correlation failure rejects completion.

[decode.ts](../src/notary/decode.ts) reads the canonical signed serialization once.
It preserves full-width timestamps without lossy number conversion and returns
`NotaryAttestation { attestedData, signature, decoded }`. It never re-encodes signed
bytes. Its cross-language fixture and digest live beside the decoder tests.
The decoded view contains only signed record data, not private transcript bytes,
bearers, blinders or witnesses.

Client checks the delivered view's structure, not its agreement with signed
bytes. Neither endpoint verifies notary signatures locally. The ledger verifier
must authenticate the original bytes and derive authoritative identity and
proof inputs from them; convenience views are not alternative evidence.

## HTTP and platform policy

[http.ts](../src/notary/http.ts) and [transcript.ts](../src/notary/transcript.ts)
handle shared byte framing and request checks. Platform selectors remain under
`platforms/<id>/1/transcript.ts`. JSON whitespace and header order do not establish
identity: selectors work from actual wire offsets, and numeric GitHub IDs are
preserved losslessly. Additional headers are admitted subject to the profile's
required fields and forbidden-header rules; duplicate required headers and
alternate Authorization framing reject.

The browser call sites are X's token and identity requests and GitHub's identity
request. GitHub's confidential token exchange belongs to Bridge; its
[browser admission code](../src/platforms/github/1/token.ts) checks request bindings,
canonical encoding and opening correlation before using the returned bearer.
GitHub's request uses the browser User-Agent. Exact header values and forbidden
names are owned by code and the specification, not copied here.

The browser bundle release is pinned in [notary.assets.ts](../src/notary/notary.assets.ts).
Use a matched service/TLSN/MPZ set. Mocked concurrency cannot detect WASM runtime
deadlocks; [runtime browser tests](../e2e/runtime.spec.ts) use real sessions, while
[qualification](qualification.md) retains the live authenticated/device gaps.

## Attestation measurements

`token-attestation` and `identity-attestation` start after the response is fetched
and selected, when TLSNotary reveal begins. Their `finished` events carry numeric
`instrumentation.attributes`: transcript/committed byte counts, commitment count,
`openings-ms` from reveal dispatch until openings arrive, and `finalization-ms`
from openings until the final correlated attestation arrives. The former includes
TLSNotary proof work; the latter is the remaining completion wait. These are
parent-observed intervals including worker delivery, not isolated computation
timings. Fetching identity can overlap token attestation.

`response-header-bytes` and `response-body-bytes` split the raw response at its
first CRLF/CRLF: headers include the status line and separator; body includes any
chunk framing. A missing boundary leaves those attributes absent. Only counts
are retained for instrumentation; transcript contents are never forwarded.

The notary session owns both event occurrences, using the operation name supplied
by its platform. Failure leaves the operation unfinished. The dev history keeps
operation timings visible and collapses their attributes beneath each operation.
