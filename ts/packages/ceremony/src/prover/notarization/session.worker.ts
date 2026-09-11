import {
  correlateAttestation,
  correlateOpenings,
  type HashOpening,
  planNotarization,
  type Transcript,
} from './notarize.js'
import type { ExactHttpRequest, Reveals } from './session.js'
import {
  decodeAttestationFrame,
  deriveNotaryWebSocketUrl,
  MAX_FRAME_PAYLOAD_BYTES,
} from './transport.js'

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

export interface NotaryHttpResponse {
  status: number
  headers: [string, number[]][]
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
    send_request(session: null, request: NotaryHttpRequest): Promise<NotaryHttpResponse>
    transcript(): Transcript
    reveal(
      reveal: ReturnType<typeof planNotarization>['reveal'],
      commit: ReturnType<typeof planNotarization>['commit'],
    ): Promise<{ sent: HashOpening[]; recv: HashOpening[] }>
    finish(): Promise<void>
    free(): void
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('open', opened)
      socket.removeEventListener('error', failed)
      socket.removeEventListener('close', failed)
    }
    const opened = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('notary WebSocket failed to open'))
    }
    socket.addEventListener('open', opened)
    socket.addEventListener('error', failed)
    socket.addEventListener('close', failed)
  })
}

function socketIo(socket: WebSocket): Io {
  const chunks: Uint8Array[] = []
  const readers: Array<{
    resolve(value: Uint8Array | null): void
    reject(reason: Error): void
  }> = []
  let ended: null | Error = null
  let closed = false

  const settle = (error: Error | null) => {
    if (closed || ended) return
    if (error) ended = error
    else closed = true
    while (readers.length) {
      const reader = readers.shift()!
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
      if (ended) return Promise.reject(ended)
      if (closed) return Promise.resolve(null)
      return new Promise((resolve, reject) => readers.push({ resolve, reject }))
    },
    write(data) {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('notary WebSocket is not open'))
      }
      try {
        socket.send(data)
        return Promise.resolve()
      } catch (error) {
        return Promise.reject(error)
      }
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
  for (;;) {
    const chunk = await io.read()
    if (chunk === null) break
    length += chunk.length
    if (length > MAX_FRAME_PAYLOAD_BYTES + 4) {
      throw new Error('notary attestation frame exceeds size limit')
    }
    chunks.push(chunk)
  }
  const frame = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    frame.set(chunk, offset)
    offset += chunk.length
  }
  return frame
}

// The module and its thread pool are initialized once for this ceremony's sessions.
let runtime: Promise<TlsnModule> | undefined
function initialize(data: Record<string, unknown>): Promise<TlsnModule> {
  runtime ??= (async () => {
    const tlsn = (await import(/* @vite-ignore */ String(data.moduleUrl))) as TlsnModule
    await tlsn.default({ module_or_path: String(data.wasmUrl) })
    await tlsn.initialize(null, Math.min(navigator.hardwareConcurrency || 1, 4))
    return tlsn
  })()
  return runtime
}

function session(port: MessagePort, initial: Record<string, unknown>) {
  let prover: InstanceType<TlsnModule['Prover']> | undefined
  let io: Io | undefined
  let transcript: Transcript | undefined
  let target = ''
  let stage = 'new'
  function reply(value: unknown) {
    port.postMessage(value)
  }
  async function work(data: Record<string, unknown>) {
    if (data.type === 'prepare' && stage === 'new') {
      stage = 'preparing'
      target = String(data.url)
      const socket = new WebSocket(deriveNotaryWebSocketUrl(String(data.notaryAddress)))
      io = socketIo(socket)
      const [tlsn] = await Promise.all([initialize(data), waitForOpen(socket)])
      if (socket.readyState !== WebSocket.OPEN) throw new Error('notary WebSocket closed')
      prover = new tlsn.Prover({
        server_name: new URL(target).hostname,
        mode: 'Proxy',
        max_sent_data: 4096,
        max_recv_data: 32768,
        network: 'Bandwidth',
      })
      await prover.setup(io)
      stage = 'prepared'
      reply({ type: 'prepared' })
      return
    }
    if (data.type === 'send' && stage === 'prepared' && prover) {
      stage = 'sending'
      const request = data.request as ExactHttpRequest
      if (request.url !== target) throw new Error('Request target changed')
      const url = new URL(target)
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
      if (raw.sent.length > 4096 || raw.recv.length > 32768)
        throw new Error('Transcript acceptance limit exceeded')
      transcript = { sent: Uint8Array.from(raw.sent), recv: Uint8Array.from(raw.recv) }
      stage = 'sent'
      reply({ type: 'sent', transcript: { sent: transcript.sent, received: transcript.recv } })
      return
    }
    if (data.type === 'reveal' && stage === 'sent' && prover && transcript && io) {
      stage = 'revealing'
      const reveals = data.reveals as Reveals
      const plan = planNotarization(transcript, { sent: reveals.sent, recv: reveals.received })
      const raw = await prover.reveal(plan.reveal, plan.commit)
      const openings = []
      for (const direction of ['sent', 'recv'] as const) {
        raw[direction] = raw[direction].map((o) => ({
          hash: Uint8Array.from(o.hash),
          blinder: Uint8Array.from(o.blinder),
        }))
        for (const { start, end, blinder } of correlateOpenings(
          transcript[direction],
          plan.commit[direction],
          raw[direction],
          direction,
        )) {
          openings.push({
            direction: direction === 'recv' ? 'received' : 'sent',
            start,
            end,
            blinder,
          })
        }
      }
      reply({ type: 'revealed', openings })
      // Final channel completion has a deadline independent of proof generation.
      const finalIo = io
      let timer: ReturnType<typeof setTimeout> | undefined
      let frame: Uint8Array
      try {
        frame = await Promise.race([
          (async () => {
            await prover!.finish()
            return readFinalFrame(finalIo)
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              void finalIo.close()
              reject(new Error('Notary finalization timed out'))
            }, 30000)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
      const wire = decodeAttestationFrame(frame)
      const { decoded } = correlateAttestation(transcript, plan, raw, wire.attestedData)
      await io.close()
      prover.free()
      prover = undefined
      transcript = undefined
      io = undefined
      stage = 'done'
      reply({ type: 'attestation', attestation: { ...wire, decoded } })
      port.close()
      return
    }
    throw new Error('Invalid notarization sequence')
  }
  function dispatch(data: Record<string, unknown>) {
    void work(data).catch(async () => {
      reply({ type: 'error' })
      stage = 'done'
      await io?.close()
      port.close()
    })
  }
  port.onmessage = (event) => dispatch(event.data)
  dispatch(initial)
}
self.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
  session(event.data.port as MessagePort, event.data)
})
