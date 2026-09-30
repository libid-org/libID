import { errorMessage } from '../errors.js'
import { workerThreads } from '../threads.js'
import type { DecodedAttestedData, DecodedDirection } from './decode.js'
import { responseSizes } from './http.js'
import { MAX_RECV_BYTES, MAX_SENT_BYTES } from './limits.js'
import {
  correlateReveal,
  type HashOpening,
  matchAttestedData,
  planNotarization,
} from './notarize.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  FromWorker,
  Prepare,
  Reveals,
  ToWorker,
  Transcript,
} from './protocol.js'
import type { Io, TlsnModule, TlsnOpening, TlsnProver } from './tlsn.js'
import {
  decodeAttestationFrame,
  deriveNotaryWebSocketUrl,
  readFinalFrame,
  socketIo,
  waitForOpen,
} from './transport.js'

const copy = (openings: readonly TlsnOpening[]): HashOpening[] =>
  openings.map((o) => ({ hash: Uint8Array.from(o.hash), blinder: Uint8Array.from(o.blinder) }))

/** How often a no-op timer turns this worker's event loop while the SDK computes. */
const HEARTBEAT_MS = 10

let heartbeatHolders = 0
let heartbeat: ReturnType<typeof setInterval> | undefined

/**
 * Run an SDK call while a no-op timer turns this worker's event loop. WebKit can leave a
 * cross-thread `Atomics.waitAsync` wake undelivered until something else turns the loop, and
 * the SDK awaits exactly such wakes from its thread pool; with no timer and no network traffic,
 * a session would hang for good. The timer releases a stranded wake within 10 ms.
 */
async function withHeartbeat<T>(call: () => Promise<T>): Promise<T> {
  if (heartbeatHolders++ === 0) heartbeat = setInterval(() => {}, HEARTBEAT_MS)
  try {
    return await call()
  } finally {
    if (--heartbeatHolders === 0) clearInterval(heartbeat)
  }
}

// The module and its thread pool are initialized once for this ceremony's sessions.
let runtime: Promise<TlsnModule> | undefined

function initialize(data: Prepare): Promise<TlsnModule> {
  runtime ??= (async () => {
    const tlsn = (await import(/* @vite-ignore */ data.moduleUrl)) as TlsnModule
    await tlsn.default({ module_or_path: data.wasmUrl })
    await withHeartbeat(() => tlsn.initialize(null, workerThreads()))
    return tlsn
  })()
  return runtime
}

/** Diagnostic counts only; transcript contents never leave through attributes. */
function attestationAttributes(
  decoded: DecodedAttestedData,
  received: Uint8Array,
): Record<string, number> {
  const committed = ({ commitments }: DecodedDirection) =>
    commitments.reduce((sum, r) => sum + r.end - r.start, 0)
  return {
    'sent-bytes': decoded.sentTranscriptLength,
    'received-bytes': decoded.receivedTranscriptLength,
    ...responseSizes(received),
    'committed-sent-bytes': committed(decoded.sent),
    'committed-received-bytes': committed(decoded.received),
    'commitment-count': decoded.sent.commitments.length + decoded.received.commitments.length,
  }
}

interface Prepared {
  phase: 'prepared'
  url: URL
  io: Io
  prover: TlsnProver
}

interface Sent extends Omit<Prepared, 'phase'> {
  phase: 'sent'
  transcript: Transcript
}

/** Each phase holds exactly what its next message needs; `busy` rejects overlapping messages. */
type State = { phase: 'new' | 'busy' | 'ended' } | Prepared | Sent

function session(port: MessagePort, initial: Prepare) {
  let state: State = { phase: 'new' }
  // Set once the socket exists, so any later failure closes it.
  let opened: Io | undefined
  const reply = (value: FromWorker) => port.postMessage(value)

  async function prepare(data: Prepare): Promise<Prepared> {
    const url = new URL(data.url)
    // The notary limits idle sockets; finish cold WASM startup before connecting.
    const tlsn = await initialize(data)
    const ws = new WebSocket(deriveNotaryWebSocketUrl(data.notaryAddress))
    const io = socketIo(ws)
    opened = io
    await waitForOpen(ws)
    // The peer may close between the open event and this continuation.
    if (ws.readyState !== WebSocket.OPEN) throw new Error('notary WebSocket closed')
    const prover = new tlsn.Prover({
      server_name: url.hostname,
      mode: 'Proxy',
      max_sent_data: MAX_SENT_BYTES,
      max_recv_data: MAX_RECV_BYTES,
      network: 'Bandwidth',
    })
    await withHeartbeat(() => prover.setup(io))
    return { phase: 'prepared', url, io, prover }
  }

  async function send(prepared: Prepared, request: ExactHttpRequest): Promise<Sent> {
    if (request.url !== initial.url) throw new Error('Request target changed')
    const { url, prover } = prepared
    await withHeartbeat(() =>
      prover.send_request(null, {
        uri: url.pathname + url.search,
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [k, Array.from(v)]),
        ),
        body: request.body.length
          ? new TextDecoder('utf-8', { fatal: true }).decode(request.body)
          : null,
      }),
    )
    const raw = prover.transcript()
    // Proxy setup limits are not enforced by the pinned SDK. This bounds acceptance
    // before parsing/reveal, not memory or traffic consumed while receiving.
    if (raw.sent.length > MAX_SENT_BYTES || raw.recv.length > MAX_RECV_BYTES)
      throw new Error('Transcript acceptance limit exceeded')
    const transcript = { sent: Uint8Array.from(raw.sent), received: Uint8Array.from(raw.recv) }
    return { ...prepared, phase: 'sent', transcript }
  }

  async function reveal({ url, io, prover, transcript }: Sent, reveals: Reveals): Promise<void> {
    const plan = planNotarization(transcript, reveals)
    const result = await withHeartbeat(() =>
      prover.reveal(
        // The SDK requires this flag; the signed authority binds the prepared host.
        { sent: plan.reveal.sent, recv: plan.reveal.received, server_identity: true },
        { sent: plan.commit.sent, recv: plan.commit.received },
      ),
    )
    const correlated = correlateReveal(transcript, plan, {
      sent: copy(result.sent),
      received: copy(result.recv),
    })
    const openings: CommitmentOpening[] = (['sent', 'received'] as const).flatMap((direction) =>
      correlated[direction].map(({ start, end, blinder }) => ({ direction, start, end, blinder })),
    )
    reply({ type: 'revealed', openings })
    await withHeartbeat(() => prover.finish())
    const wire = decodeAttestationFrame(await readFinalFrame(io))
    const decoded = matchAttestedData(url.hostname, transcript, plan, correlated, wire.attestedData)
    await io.close()
    prover.free()
    reply({
      type: 'attestation',
      attestation: wire,
      attributes: attestationAttributes(decoded, transcript.received),
    })
  }

  async function work(data: Prepare | ToWorker): Promise<void> {
    const current = state
    state = { phase: 'busy' }
    switch (data.type) {
      case 'prepare':
        if (current.phase !== 'new') break
        state = await prepare(data)
        return reply({ type: 'prepared' })
      case 'send':
        if (current.phase !== 'prepared') break
        state = await send(current, data.request)
        return reply({ type: 'sent', transcript: state.transcript })
      case 'reveal':
        if (current.phase !== 'sent') break
        await reveal(current, data.reveals)
        state = { phase: 'ended' }
        return port.close()
    }
    throw new Error('Invalid notarization sequence')
  }

  function dispatch(data: Prepare | ToWorker) {
    void work(data).catch(async (error) => {
      reply({ type: 'error', message: errorMessage(error) })
      state = { phase: 'ended' }
      await opened?.close()
      port.close()
    })
  }
  port.onmessage = (event: MessageEvent<ToWorker>) => dispatch(event.data)
  dispatch(initial)
}

self.addEventListener('message', (event: MessageEvent<Prepare>) => {
  session(event.data.port, event.data)
})
