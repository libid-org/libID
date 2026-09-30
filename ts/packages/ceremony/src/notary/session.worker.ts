import { concatBytes } from '@noble/hashes/utils.js'
import { errorMessage } from '../errors.js'
import { workerThreads } from '../threads.js'
import type { DecodedAttestedData, DecodedDirection } from './decode.js'
import { responseSizes } from './http.js'
import { MAX_FRAME_BYTES, MAX_RECV_BYTES, MAX_SENT_BYTES } from './limits.js'
import {
  type CommitRange,
  correlateReveal,
  type HashOpening,
  matchAttestedData,
  planNotarization,
} from './notarize.js'
import type {
  ByteRange,
  CommitmentOpening,
  ExactHttpRequest,
  FromWorker,
  Prepare,
  Reveals,
  ToWorker,
  Transcript,
} from './protocol.js'
import { decodeAttestationFrame, deriveNotaryWebSocketUrl } from './transport.js'

interface Io {
  read(): Promise<Uint8Array | null>
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface NotaryHttpRequest {
  uri: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, number[]>
  body: unknown
}

interface TlsnModule {
  default(options: { module_or_path: string }): Promise<void>
  initialize(logging: null, threads: number): Promise<void>
  Prover: new (config: {
    server_name: string
    mode: 'Proxy'
    max_sent_data: number
    max_recv_data: number
    network: 'Bandwidth'
  }) => {
    setup(io: Io): Promise<void>
    send_request(session: null, request: NotaryHttpRequest): Promise<unknown>
    transcript(): { sent: Uint8Array; recv: Uint8Array }
    reveal(
      reveal: {
        sent: readonly ByteRange[]
        recv: readonly ByteRange[]
        server_identity: true
      },
      commit: {
        sent: readonly CommitRange[]
        recv: readonly CommitRange[]
      },
    ): Promise<{ sent: HashOpening[]; recv: HashOpening[] }>
    finish(): Promise<void>
    free(): void
  }
}

type Prover = InstanceType<TlsnModule['Prover']>

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
  const listening = new AbortController(),
    signal = listening.signal
  return new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error('notary WebSocket failed to open'))
    socket.addEventListener('open', () => resolve(), { signal })
    socket.addEventListener('error', failed, { signal })
    socket.addEventListener('close', failed, { signal })
  }).finally(() => listening.abort())
}

function socketIo(socket: WebSocket): Io {
  const chunks: Uint8Array[] = []
  const readers: PromiseWithResolvers<Uint8Array | null>[] = []
  // The first error or close ends reading once buffered chunks drain; later events are ignored.
  let end: { error: Error | null } | undefined

  const settle = (error: Error | null) => {
    if (end) return
    end = { error }
    for (const reader of readers.splice(0)) {
      if (error) reader.reject(error)
      else reader.resolve(null)
    }
  }

  socket.binaryType = 'arraybuffer'
  socket.addEventListener('message', (event) => {
    if (!(event.data instanceof ArrayBuffer))
      return settle(new Error('notary sent non-binary data'))
    const chunk = new Uint8Array(event.data)
    const reader = readers.shift()
    if (reader) reader.resolve(chunk)
    else chunks.push(chunk)
  })
  socket.addEventListener('error', () => settle(new Error('notary WebSocket failed')))
  socket.addEventListener('close', () => settle(null))

  return {
    read() {
      const chunk = chunks.shift()
      if (chunk) return Promise.resolve(chunk)
      if (end) return end.error ? Promise.reject(end.error) : Promise.resolve(null)
      const reader = Promise.withResolvers<Uint8Array | null>()
      readers.push(reader)
      return reader.promise
    },
    write(data) {
      // The pinned SDK catches synchronous throws but discards write promises.
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('notary WebSocket is not open')
      }
      socket.send(data)
      return Promise.resolve()
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      return Promise.resolve()
    },
  }
}

async function readFinalFrame(io: Io): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for (let chunk = await io.read(); chunk !== null; chunk = await io.read()) {
    length += chunk.length
    if (length > MAX_FRAME_BYTES) throw new Error('notary attestation frame exceeds size limit')
    chunks.push(chunk)
  }
  return concatBytes(...chunks)
}

/** SDK openings may arrive as plain arrays. */
const copy = (openings: readonly HashOpening[]): HashOpening[] =>
  openings.map((o) => ({ hash: Uint8Array.from(o.hash), blinder: Uint8Array.from(o.blinder) }))

// The module and its thread pool are initialized once for this ceremony's sessions.
let runtime: Promise<TlsnModule> | undefined

function initialize(data: Prepare): Promise<TlsnModule> {
  runtime ??= (async () => {
    const tlsn = (await import(/* @vite-ignore */ data.moduleUrl)) as TlsnModule
    await tlsn.default({ module_or_path: data.wasmUrl })
    await tlsn.initialize(null, workerThreads())
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
  stage: 'prepared'
  url: URL
  io: Io
  prover: Prover
}

interface Sent extends Omit<Prepared, 'stage'> {
  stage: 'sent'
  transcript: Transcript
}

/** Each stage holds exactly what its next message needs; `busy` rejects overlapping messages. */
type State = { stage: 'new' | 'busy' | 'done' } | Prepared | Sent

function session(port: MessagePort, initial: Prepare) {
  let state: State = { stage: 'new' }
  // Set once the socket exists, so any later failure closes it.
  let socket: Io | undefined
  const reply = (value: FromWorker) => port.postMessage(value)

  async function prepare(data: Prepare): Promise<Prepared> {
    const url = new URL(data.url)
    // The notary limits idle sockets; finish cold WASM startup before connecting.
    const tlsn = await initialize(data)
    const ws = new WebSocket(deriveNotaryWebSocketUrl(data.notaryAddress))
    const io = socketIo(ws)
    socket = io
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
    await prover.setup(io)
    return { stage: 'prepared', url, io, prover }
  }

  async function send(prepared: Prepared, request: ExactHttpRequest): Promise<Sent> {
    if (request.url !== initial.url) throw new Error('Request target changed')
    const { url, prover } = prepared
    await prover.send_request(null, {
      uri: url.pathname + url.search,
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([k, v]) => [k, Array.from(v)]),
      ),
      body: request.body.length
        ? new TextDecoder('utf-8', { fatal: true }).decode(request.body)
        : null,
    })
    const raw = prover.transcript()
    // Proxy setup limits are not enforced by the pinned SDK. This bounds acceptance
    // before parsing/reveal, not memory or traffic consumed while receiving.
    if (raw.sent.length > MAX_SENT_BYTES || raw.recv.length > MAX_RECV_BYTES)
      throw new Error('Transcript acceptance limit exceeded')
    const transcript = { sent: Uint8Array.from(raw.sent), received: Uint8Array.from(raw.recv) }
    return { ...prepared, stage: 'sent', transcript }
  }

  async function reveal({ url, io, prover, transcript }: Sent, reveals: Reveals): Promise<void> {
    const plan = planNotarization(transcript, reveals)
    const result = await prover.reveal(
      // The SDK requires this flag; the signed authority binds the prepared host.
      { sent: plan.reveal.sent, recv: plan.reveal.received, server_identity: true },
      { sent: plan.commit.sent, recv: plan.commit.received },
    )
    const correlated = correlateReveal(transcript, plan, {
      sent: copy(result.sent),
      received: copy(result.recv),
    })
    const openings: CommitmentOpening[] = (['sent', 'received'] as const).flatMap((direction) =>
      correlated[direction].map(({ start, end, blinder }) => ({ direction, start, end, blinder })),
    )
    reply({ type: 'revealed', openings })
    await prover.finish()
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
    state = { stage: 'busy' }
    switch (data.type) {
      case 'prepare':
        if (current.stage !== 'new') break
        state = await prepare(data)
        return reply({ type: 'prepared' })
      case 'send':
        if (current.stage !== 'prepared') break
        state = await send(current, data.request)
        return reply({ type: 'sent', transcript: state.transcript })
      case 'reveal':
        if (current.stage !== 'sent') break
        await reveal(current, data.reveals)
        state = { stage: 'done' }
        return port.close()
    }
    throw new Error('Invalid notarization sequence')
  }

  function dispatch(data: Prepare | ToWorker) {
    void work(data).catch(async (error) => {
      reply({ type: 'error', message: errorMessage(error) })
      state = { stage: 'done' }
      await socket?.close()
      port.close()
    })
  }
  port.onmessage = (event: MessageEvent<ToWorker>) => dispatch(event.data)
  dispatch(initial)
}

self.addEventListener('message', (event: MessageEvent<Prepare>) => {
  session(event.data.port, event.data)
})
