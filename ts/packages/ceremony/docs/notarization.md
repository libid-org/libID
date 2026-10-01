# Browser notarization

The [notary module](../src/notary/) adapts the pinned TLSNotary WASM Proxy API.
Platform code owns exact requests, response parsing and disclosure selection;
the adapter owns sessions, transcript bounds, final-frame delivery and correlation.
The [platform specification](https://github.com/libid-org/libid/blob/49ad6653c11e9f1fe2f0680d1f70754aefb9878f/specs/platform-ceremonies.md)
owns authoritative request/evidence rules.

## Session lifecycle

[NotaryRuntime](../src/notary/session.ts) owns one WASM runtime/thread pool per
ceremony. Each `prepare(url)` creates a separate TLS session and WebSocket,
with its own channel, phase and pending replies.
Preparation needs a fixed HTTPS target but no bearer, so independent sessions
can prepare concurrently. The notary connects to the target only when `send`
starts TLS; preparation does not establish target reachability, so target
connection failures reject `send`.

| Operation | Available output |
|---|---|
| `prepare(url)` | One prepared session bound to that exact URL. |
| `session.send(request)` | Original sent/received transcript after one request. |
| `session.reveal(ranges)` | Private commitment openings and a pending `attestation` promise. |
| `await result.attestation` | Original signed bytes after final correlation. |

Transcript parsing and circuit input construction can use early material while final
attestations remain pending. That material is provisional: delivery must join
all final attestations and the generated proof. A late failure discards the
speculative result. See [X/GitHub scheduling](provers.md).

The supplied abort signal releases the shared worker, including idle prepared
sessions. Any session failure aborts sibling work. Successful sessions release
their own prover/channel; the platform's `finally` abort releases the shared
runtime. Each request has one 10-second timeout from `send()` until its final
attestation arrives. The budget includes response receipt, disclosure selection,
openings and finalization; it does not restart between these steps. Each session's
setup has its own 10-second deadline, which fails as that session's fetch; together
they keep X's token request inside X's 30-second code deadline. The deadline starts
once the SDK runtime has loaded, so a slow download of the runtime never fails a
ceremony. Idle bearer waiting and ZK proving are outside both. Timeout
rejects pending calls and terminates the shared worker without waiting for SDK
completion. The platform retires its proof engine, and Prover reports one failure
and stops its UI. Types and exact method constraints stay beside the implementation.

## Transport and bounds

The adapter receives the client's frozen notary origin. HTTPS maps to WSS
`/notarize-proxy`; allowed loopback HTTP maps to WS. Platform requests remain
HTTPS. There is no session-creation HTTP request, polling endpoint, alternate
notary selection or browser notary-key lookup.

[session.worker.ts](../src/notary/session.worker.ts) initializes the shared WASM
runtime before opening session sockets, so cold loading does not consume the
notary’s idle-socket deadline. Target-specific TLS setups still run concurrently.
While any SDK call runs, a 10 ms no-op timer keeps the worker's event loop turning:
WebKit can leave a cross-thread `Atomics.waitAsync` wake undelivered until something
else wakes the worker ([WebKit bug 325822](https://bugs.webkit.org/show_bug.cgi?id=325822)),
and the SDK waits on such wakes during its PRF step, where no network traffic arrives
to wake it. The timer can go once that bug is fixed in the supported engines.
After TLSNotary finishes, it reclaims the same channel for one length-prefixed
JSON attestation frame and requires EOF. [transport.ts](../src/notary/transport.ts)
owns frame bounds and exact decoding. The shared request timeout also covers an
unfinished final frame or missing EOF.

The adapter admits at most 4 KiB sent and 32 KiB received transcript bytes before
exposing them to parsing/reveal. These are post-receive acceptance limits: the
pinned Proxy runtime does not enforce the supplied setup limits as reception
memory/network caps. Keep that limitation explicit when qualifying resource use.

## Evidence handling

[notarize.ts](../src/notary/notarize.ts) validates selected ranges, merges adjacent
reveals as TLSNotary does, and commits the complement. It correlates private
openings with planned commitments once, then verifies transcript lengths, reveals
and those correlated hashes against the final attested bytes, including the
authority identifier for the prepared HTTPS host.
Missing coverage, wrong framing or correlation failure rejects completion.

[decode.ts](../src/notary/decode.ts) reads the canonical signed serialization once
inside the worker, preserving full-width timestamps. Correlation and diagnostic
sizes use that internal record. The delivered `NotaryAttestation` contains only
original `attestedData` and `signature` bytes. Signed bytes are never re-encoded;
the cross-language fixture and digest live beside the decoder tests.

Client bounds delivered bytes and decodes the token attestation to derive
[retention expiry](client.md#results-and-errors). Applications forward the original
opaque evidence to their ledger adapter/verifier; the separate `Identity` is for
local presentation. The decoder remains a private package API. Neither endpoint verifies
notary signatures locally. The ledger verifier authenticates the original bytes
and derives authoritative identity and proof inputs from them.

## HTTP and platform policy

[http.ts](../src/notary/http.ts) tokenizes HTTP heads on wire bytes for both
directions and UTF-8-decodes a response body only after removing chunked framing.
Each caller keeps its own field policy: [transcript.ts](../src/notary/transcript.ts)
selects JSON fields from raw bytes, and the X/GitHub
[exchange machinery](../src/barretenberg/circuits/bearer-link/exchange.ts) owns the token and
identity request checks. It consumes the fixed
layouts each platform's `provider.ts` declares. JSON whitespace and header
order do not establish identity: selectors work from actual wire offsets, and numeric GitHub IDs are
preserved losslessly. Additional headers are admitted subject to the layout's
required fields and forbidden-header rules; duplicate required headers and
alternate Authorization framing reject.

JSON decoding uses `JSON.parse`; HTTP framing, response bounds and output shapes
are checked separately. Authoritative field uniqueness and location rely on
ASM-PROV-06. Delivered IDs come from selected transcript bytes, never rounded JSON
numbers. Byte selectors still reject duplicate disclosure delimiters.

Both X and GitHub obtain token and identity through browser Proxy sessions.
GitHub's [token selector](../src/platforms/github/1/exchange.ts) checks the complete
request against the frozen canonical form before using the returned bearer.
GitHub's identity request uses a fixed, generic User-Agent without browser or OS details. Exact header values and forbidden
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
chunk framing. A missing boundary leaves those attributes absent. The worker
computes every count; the parent adds only its two intervals. Transcript contents
are never forwarded as instrumentation.

The notary session owns both event occurrences, using the operation name supplied
by its platform. Failure leaves the operation unfinished. The dev history keeps
operation timings visible and collapses their attributes beneath each operation.
