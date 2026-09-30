import { afterEach, expect, it, vi } from 'vitest'
import { exactRequest, httpResponse, utf8 } from '../testing/index.js'
import { posted, stubWorkerScope } from '../testing/workers.js'
import { encodeAttestation, frameJson, opening } from './fixtures/attestation.js'
import { MAX_FRAME_BYTES } from './limits.js'
import { planNotarization } from './notarize.js'

class Socket extends EventTarget {
  static OPEN = 1
  static CONNECTING = 0
  readyState = 1
  binaryType = ''

  send() {}

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const target = 'https://api.x.com/2/users/me'

const request = exactRequest(target)

type Port = ReturnType<typeof replyPort>

/** The parent's end of one session channel: records replies and delivers parent messages. */
function replyPort() {
  const port = {
    postMessage: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
  }
  return Object.assign(port, {
    replied: (type: string) => posted(port.postMessage, type),
    send: (data: unknown) => port.onmessage!({ data }),
  })
}

/**
 * Load the session worker with `socket` as its WebSocket. `prepare(port)` then starts a session
 * whose TLSN module is `sdk`, source that reaches its test hooks through globals.
 */
async function loadWorker(sdk: string, socket: new (url: string) => Socket = Socket) {
  const scope = stubWorkerScope()
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal('WebSocket', socket)
  await import('./session.worker.js')
  const moduleUrl = `data:text/javascript,${encodeURIComponent(sdk)}`
  return {
    scope,
    prepare: (port: Port, url = target) =>
      scope.deliver({
        type: 'prepare',
        port,
        url,
        moduleUrl,
        wasmUrl: 'unused',
        notaryAddress: 'https://notary.test',
      }),
  }
}

async function worker(sent: number, recv: number) {
  const port = replyPort()
  const { scope, prepare } = await loadWorker(
    `export default async()=>{};export async function initialize(){};export class Prover {async setup(){}async send_request(){}transcript(){return{sent:new Uint8Array(${sent}),recv:new Uint8Array(${recv})}}async reveal(){return{sent:[],recv:[]}}async finish(){}}`,
  )
  prepare(port)
  await expect.poll(() => port.replied('prepared')).toBe(true)
  port.send({ type: 'send', request })
  return { port, scope }
}

it.each([
  [4096, 32768, true],
  [4097, 0, false],
  [0, 32769, false],
])(
  'checks actual SDK transcript lengths %i/%i before resolving send [LIBID-PROVER-008]',
  async (sent, recv, accepted) => {
    const { port, scope } = await worker(sent, recv)
    await expect.poll(() => port.replied(accepted ? 'sent' : 'error')).toBe(true)
    if (!accepted) {
      expect(port.replied('sent')).toBe(false)
      expect(port.close).toHaveBeenCalledOnce()
      expect(scope.close).not.toHaveBeenCalled()
    }
  },
)

it('correlates plain-array SDK openings, then verifies the final frame before delivery', async () => {
  const transcript = { sent: utf8('GET /2/users/me'), received: httpResponse('{}') }
  const reveals = {
    sent: [{ start: 0, end: 3 }],
    received: [
      { start: 0, end: 8 },
      { start: 12, end: 14 },
    ],
  }
  const plan = planNotarization(transcript, reveals)
  const raw = {
    sent: plan.commit.sent.map((range) => opening(transcript.sent, range, 1)),
    recv: plan.commit.received.map((range, i) => opening(transcript.received, range, 2 + i)),
  }
  const attestedData = encodeAttestation(transcript, plan, {
    sent: raw.sent.map((o) => o.hash),
    received: raw.recv.map((o) => o.hash),
  })
  const frame = frameJson({ attested_data: [...attestedData], notary_signature: Array(65).fill(9) })
  let socket!: Socket
  vi.stubGlobal('tlsnReveal', {
    transcript: { sent: transcript.sent, recv: transcript.received },
    // The SDK hands back plain arrays in its own order.
    reveal: () => ({
      sent: raw.sent.map((o) => ({ hash: [...o.hash], blinder: [...o.blinder] })),
      recv: raw.recv.map((o) => ({ hash: [...o.hash], blinder: [...o.blinder] })).reverse(),
    }),
    finish() {
      socket.dispatchEvent(new MessageEvent('message', { data: frame.slice(0, 9).buffer }))
      socket.dispatchEvent(new MessageEvent('message', { data: frame.slice(9).buffer }))
      socket.close()
    },
  })
  const { prepare } = await loadWorker(
    `export default async()=>{};export async function initialize(){};export class Prover {async setup(){}async send_request(){}transcript(){return globalThis.tlsnReveal.transcript}async reveal(){return globalThis.tlsnReveal.reveal()}async finish(){globalThis.tlsnReveal.finish()}free(){}}`,
    class extends Socket {
      constructor() {
        super()
        socket = this
      }
    },
  )
  const port = replyPort()
  prepare(port)
  await expect.poll(() => port.replied('prepared')).toBe(true)
  port.send({ type: 'send', request })
  await expect.poll(() => port.replied('sent')).toBe(true)
  port.send({ type: 'reveal', reveals })
  await expect.poll(() => port.close.mock.calls.length).toBe(1)
  expect(port.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
    'prepared',
    'sent',
    'revealed',
    'attestation',
  ])
  const [, , [revealed], [final]] = port.postMessage.mock.calls
  expect(revealed.openings).toEqual([
    { direction: 'sent', start: 3, end: 15, blinder: raw.sent[0].blinder },
    { direction: 'received', start: 8, end: 12, blinder: raw.recv[0].blinder },
    { direction: 'received', start: 14, end: 21, blinder: raw.recv[1].blinder },
  ])
  expect(final).toEqual({
    type: 'attestation',
    attestation: { attestedData, signature: new Uint8Array(65).fill(9) },
    attributes: {
      'sent-bytes': transcript.sent.length,
      'received-bytes': transcript.received.length,
      'response-header-bytes': 19,
      'response-body-bytes': 2,
      'committed-sent-bytes': 12,
      'committed-received-bytes': 11,
      'commitment-count': 3,
    },
  })
})

it('initializes one WASM pool and overlaps setup while keeping per-session transcripts', async () => {
  const setup = Promise.withResolvers<void>()
  const hooks = { init: vi.fn(), initialize: vi.fn(), setup: vi.fn(() => setup.promise) }
  vi.stubGlobal('tlsnTest', hooks)
  const { scope, prepare } = await loadWorker(
    `export default async()=>globalThis.tlsnTest.init();export async function initialize(){globalThis.tlsnTest.initialize()}let id=0;export class Prover {constructor(){this.id=++id}async setup(){await globalThis.tlsnTest.setup()}async send_request(){}transcript(){return{sent:[this.id],recv:[]}}}`,
  )
  const ports = [replyPort(), replyPort()]
  for (const port of ports) prepare(port)
  // Both setups enter before either is allowed to finish; no global session lock.
  await expect.poll(() => hooks.setup.mock.calls.length).toBe(2)
  expect(hooks.init).toHaveBeenCalledOnce()
  expect(hooks.initialize).toHaveBeenCalledOnce()
  expect(ports.every((port) => port.postMessage.mock.calls.length === 0)).toBe(true)
  setup.resolve()
  await expect
    .poll(() => ports.every((port) => port.postMessage.mock.calls.length === 1))
    .toBe(true)
  for (const port of ports) port.send({ type: 'send', request })
  await expect
    .poll(() => ports.every((port) => port.postMessage.mock.calls.length === 2))
    .toBe(true)
  expect(ports.map((port) => port.postMessage.mock.calls[1][0].transcript.sent[0])).toEqual([1, 2])
  expect(scope.close).not.toHaveBeenCalled()
})

/** An SDK recording its configuration and requests; `finish` runs `tlsnSessionTest.finish`. */
const RECORDING_SDK = `export default async()=>{};export async function initialize(){};export class Prover {constructor(config){globalThis.tlsnSessionTest.configs.push(config)}async setup(){}async send_request(_,request){globalThis.tlsnSessionTest.requests.push(request)}transcript(){return{sent:new Uint8Array([1,2]),recv:new Uint8Array([3,4])}}async reveal(){return{sent:[],recv:[]}}async finish(){globalThis.tlsnSessionTest.finish()}free(){}}`

/** A prepared session on the recording SDK, with its socket and recorded SDK calls. */
async function recording(url = target, finish = () => {}) {
  const hooks = { configs: [] as unknown[], requests: [] as unknown[], finish }
  vi.stubGlobal('tlsnSessionTest', hooks)
  const sockets: { url: string; socket: Socket }[] = []
  const { prepare } = await loadWorker(
    RECORDING_SDK,
    class extends Socket {
      constructor(url: string) {
        super()
        sockets.push({ url, socket: this })
      }
    },
  )
  const port = replyPort()
  prepare(port, url)
  await expect.poll(() => port.replied('prepared')).toBe(true)
  return { hooks, port, sockets }
}

it.each([
  [
    'a bodiless GET',
    exactRequest(`${target}?user.fields=id`, { headers: { Authorization: utf8('Bearer token') } }),
    { Authorization: Array.from(utf8('Bearer token')) },
    null,
  ],
  [
    'a form POST',
    exactRequest('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Length': utf8('7') },
      body: utf8('code=é'),
    }),
    { 'Content-Length': Array.from(utf8('7')) },
    'code=é',
  ],
])(
  'hands the SDK %s on the target and notary it was prepared for [LIBID-PROVER-008]',
  async (_, request, headers, body) => {
    const { hooks, port, sockets } = await recording(request.url)
    const url = new URL(request.url)
    expect(sockets.map((s) => s.url)).toEqual(['wss://notary.test/notarize-proxy'])
    expect(hooks.configs).toEqual([
      {
        server_name: 'api.x.com',
        mode: 'Proxy',
        max_sent_data: 4096,
        max_recv_data: 32768,
        network: 'Bandwidth',
      },
    ])
    port.send({ type: 'send', request })
    await expect.poll(() => port.replied('sent')).toBe(true)
    expect(hooks.requests).toEqual([
      { uri: url.pathname + url.search, method: request.method, headers, body },
    ])
  },
)

it.each([
  [
    'a send to another target',
    { type: 'send', request: exactRequest(`${target}?x=1`) },
    'Request target changed',
  ],
  [
    'a reveal before send',
    { type: 'reveal', reveals: { sent: [], received: [] } },
    'Invalid notarization sequence',
  ],
  ['a second prepare', { type: 'prepare' }, 'Invalid notarization sequence'],
])('fails the session on %s and closes its socket', async (_, message, reason) => {
  const { hooks, port, sockets } = await recording()
  port.send(message)
  await expect.poll(() => port.close.mock.calls.length).toBe(1)
  expect(port.postMessage.mock.calls.map(([m]) => m)).toEqual([
    { type: 'prepared' },
    { type: 'error', message: reason },
  ])
  expect(hooks.requests).toEqual([])
  expect(sockets[0].socket.readyState).toBe(3)
})

it.each([
  [
    'non-binary data',
    (socket: Socket) => socket.dispatchEvent(new MessageEvent('message', { data: 'frame' })),
    'notary sent non-binary data',
  ],
  [
    'an oversize frame',
    (socket: Socket) =>
      socket.dispatchEvent(
        new MessageEvent('message', { data: new ArrayBuffer(MAX_FRAME_BYTES + 1) }),
      ),
    'notary attestation frame exceeds size limit',
  ],
  [
    'a socket error',
    (socket: Socket) => socket.dispatchEvent(new Event('error')),
    'notary WebSocket failed',
  ],
])(
  'fails the final attestation on %s arriving after openings [LIBID-PROVER-008]',
  async (_, deliver, reason) => {
    // Delivered after finish, while the frame reader waits.
    const { port, sockets } = await recording(target, () => {
      setTimeout(() => deliver(sockets[0].socket), 0)
    })
    port.send({ type: 'send', request })
    await expect.poll(() => port.replied('sent')).toBe(true)
    port.send({
      type: 'reveal',
      reveals: { sent: [{ start: 0, end: 2 }], received: [{ start: 0, end: 2 }] },
    })
    await expect.poll(() => port.close.mock.calls.length).toBe(1)
    expect(port.postMessage.mock.calls.map(([m]) => m)).toEqual([
      { type: 'prepared' },
      { type: 'sent', transcript: { sent: Uint8Array.of(1, 2), received: Uint8Array.of(3, 4) } },
      { type: 'revealed', openings: [] },
      { type: 'error', message: reason },
    ])
  },
)

it('reads nothing that arrives after the socket failed [LIBID-PROVER-008]', async () => {
  // Delivered during finish, before the frame reader starts.
  const { port, sockets } = await recording(target, () => {
    const { socket } = sockets[0]
    socket.dispatchEvent(new MessageEvent('message', { data: 'frame' }))
    socket.dispatchEvent(
      new MessageEvent('message', { data: new ArrayBuffer(MAX_FRAME_BYTES + 1) }),
    )
  })
  port.send({ type: 'send', request })
  await expect.poll(() => port.replied('sent')).toBe(true)
  port.send({
    type: 'reveal',
    reveals: { sent: [{ start: 0, end: 2 }], received: [{ start: 0, end: 2 }] },
  })
  await expect.poll(() => port.close.mock.calls.length).toBe(1)
  expect(port.postMessage.mock.calls.at(-1)?.[0]).toEqual({
    type: 'error',
    message: 'notary sent non-binary data',
  })
})

/** A session whose runtime startup is gated and whose WebSocket starts out connecting. */
async function preparing() {
  let socket!: Socket
  const startup = Promise.withResolvers<void>()
  const hooks = {
    init: vi.fn(() => startup.promise),
    setup: vi.fn<(io: { write(data: Uint8Array): Promise<void> }) => void>(),
  }
  vi.stubGlobal('tlsnConnectTest', hooks)
  const { prepare } = await loadWorker(
    `export default async()=>globalThis.tlsnConnectTest.init();export async function initialize(){};export class Prover {async setup(io){globalThis.tlsnConnectTest.setup(io)}}`,
    class extends Socket {
      constructor() {
        super()
        this.readyState = Socket.CONNECTING
        socket = this
      }
    },
  )
  const port = replyPort()
  prepare(port)
  await expect.poll(() => hooks.init.mock.calls.length).toBe(1)
  expect(socket).toBeUndefined()
  return {
    hooks,
    port,
    get socket() {
      return socket
    },
    async resolve() {
      startup.resolve()
      await expect.poll(() => socket).toBeDefined()
    },
    reject: startup.reject,
    open() {
      socket.readyState = Socket.OPEN
      socket.dispatchEvent(new Event('open'))
    },
  }
}

it('opens the socket only after runtime startup, then waits for connection [LIBID-PROVER-018]', async () => {
  const w = await preparing()
  expect(w.socket).toBeUndefined()
  expect(w.hooks.setup).not.toHaveBeenCalled()
  await w.resolve()
  expect(w.hooks.setup).not.toHaveBeenCalled()
  expect(w.port.postMessage).not.toHaveBeenCalled()
  w.open()
  await expect.poll(() => w.port.postMessage.mock.calls.length).toBe(1)
  expect(w.port.postMessage).toHaveBeenCalledWith({ type: 'prepared' })
  expect(w.hooks.setup).toHaveBeenCalledOnce()
})

it.each(['runtime', 'socket-error', 'socket-close'])(
  '%s failure retires preparation [LIBID-PROVER-018]',
  async (failure) => {
    const w = await preparing()
    if (failure === 'runtime') w.reject(new Error('WASM failed'))
    else {
      await w.resolve()
      if (failure === 'socket-error') w.socket.dispatchEvent(new Event('error'))
      else w.socket.close()
    }
    await expect.poll(() => w.port.close.mock.calls.length).toBe(1)
    expect(w.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: expect.any(String),
    })
    if (failure === 'runtime') expect(w.socket).toBeUndefined()
    else expect(w.socket.readyState).toBe(3)
    expect(w.hooks.setup).not.toHaveBeenCalled()
    expect(w.port.postMessage).toHaveBeenCalledOnce()
  },
)

it('rejects a socket closed immediately after opening [LIBID-PROVER-018]', async () => {
  const w = await preparing()
  await w.resolve()
  w.open()
  w.socket.close()
  await expect.poll(() => w.port.close.mock.calls.length).toBe(1)
  expect(w.port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'error',
    message: expect.any(String),
  })
  expect(w.hooks.setup).not.toHaveBeenCalled()
})

it.each(['closed', 'send throws'])(
  'surfaces %s socket writes to the SDK without awaiting its discarded Promise',
  async (failure) => {
    const w = await preparing()
    await w.resolve()
    w.open()
    await expect.poll(() => w.hooks.setup.mock.calls.length).toBe(1)
    const [io] = w.hooks.setup.mock.calls[0]
    const expected = new Error(
      failure === 'closed' ? 'notary WebSocket is not open' : 'Socket send failed',
    )
    if (failure === 'closed') w.socket.readyState = 3
    else
      w.socket.send = () => {
        throw expected
      }
    let caught: unknown
    try {
      // The pinned SDK catches synchronous throws but does not await write promises.
      // Consume a rejected promise only to keep the failing regression test handled.
      void io.write(new Uint8Array([1])).catch(() => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toEqual(expected)
  },
)
