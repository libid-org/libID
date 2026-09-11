import { afterEach, expect, it, vi } from 'vitest'

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})
async function worker(sent: number, recv: number) {
  let receive!: (event: { data: unknown }) => void
  const postMessage = vi.fn(),
    close = vi.fn()
  const port = { postMessage, close, onmessage: null as null | typeof receive }
  vi.stubGlobal('self', {
    postMessage,
    close,
    addEventListener: (_type: string, handler: typeof receive) => {
      receive = handler
    },
  })
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal('WebSocket', Socket)
  await import('./session.worker.js')
  const source = `export default async()=>{};export async function initialize(){};export class Prover {async setup(){}async send_request(){}transcript(){return{sent:new Uint8Array(${sent}),recv:new Uint8Array(${recv})}}async reveal(){return{sent:[],recv:[]}}async finish(){}}`
  receive({
    data: {
      type: 'prepare',
      port,
      url: 'https://api.x.com/2/users/me',
      moduleUrl: `data:text/javascript,${encodeURIComponent(source)}`,
      wasmUrl: 'unused',
      notaryAddress: 'https://notary.test',
    },
  })
  await expect.poll(() => postMessage.mock.calls.some(([m]) => m.type === 'prepared')).toBe(true)
  port.onmessage!({
    data: {
      type: 'send',
      request: {
        url: 'https://api.x.com/2/users/me',
        method: 'GET',
        headers: {},
        body: new Uint8Array(),
      },
    },
  })
  return { postMessage, close, receive: port.onmessage! }
}
it.each([
  [4096, 32768, true],
  [4097, 0, false],
  [0, 32769, false],
])(
  'checks actual SDK transcript lengths %i/%i before resolving send [LIBID-PROVER-008]',
  async (sent, recv, accepted) => {
    const result = await worker(sent, recv)
    await expect
      .poll(() =>
        result.postMessage.mock.calls.some(([m]) => m.type === (accepted ? 'sent' : 'error')),
      )
      .toBe(true)
    if (!accepted) {
      expect(result.postMessage.mock.calls.some(([m]) => m.type === 'sent')).toBe(false)
      expect(result.close).toHaveBeenCalledOnce()
    }
  },
)
it('missing final EOF terminates rather than hanging indefinitely', async () => {
  const result = await worker(0, 0)
  await expect.poll(() => result.postMessage.mock.calls.some(([m]) => m.type === 'sent')).toBe(true)
  vi.useFakeTimers()
  result.receive({ data: { type: 'reveal', reveals: { sent: [], received: [] } } })
  await vi.advanceTimersByTimeAsync(30001)
  expect(result.postMessage.mock.calls.some(([m]) => m.type === 'error')).toBe(true)
  expect(result.postMessage.mock.calls.some(([m]) => m.type === 'attestation')).toBe(false)
  expect(result.close).toHaveBeenCalledOnce()
})

it('initializes one WASM pool and overlaps setup while keeping per-session transcripts', async () => {
  let receive!: (event: { data: unknown }) => void
  const close = vi.fn()
  vi.stubGlobal('self', {
    close,
    addEventListener: (_: string, handler: typeof receive) => {
      receive = handler
    },
  })
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal('WebSocket', Socket)
  let finishSetup!: () => void
  const gate = new Promise<void>((resolve) => {
    finishSetup = resolve
  })
  const hooks = { init: vi.fn(), initialize: vi.fn(), setup: vi.fn(() => gate) }
  vi.stubGlobal('tlsnTest', hooks)
  await import('./session.worker.js')
  const source = `export default async()=>globalThis.tlsnTest.init();export async function initialize(){globalThis.tlsnTest.initialize()}let id=0;export class Prover {constructor(){this.id=++id}async setup(){await globalThis.tlsnTest.setup()}async send_request(){}transcript(){return{sent:[this.id],recv:[]}}}`
  const ports = [0, 1].map(() => ({
    postMessage: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | typeof receive,
  }))
  for (const port of ports)
    receive({
      data: {
        type: 'prepare',
        port,
        url: 'https://api.x.com/2/users/me',
        moduleUrl: `data:text/javascript,${encodeURIComponent(source)}`,
        wasmUrl: 'unused',
        notaryAddress: 'https://notary.test',
      },
    })
  // Both setups enter before either is allowed to finish; no global session lock.
  await expect.poll(() => hooks.setup.mock.calls.length).toBe(2)
  expect(hooks.init).toHaveBeenCalledOnce()
  expect(hooks.initialize).toHaveBeenCalledOnce()
  expect(ports.every((port) => port.postMessage.mock.calls.length === 0)).toBe(true)
  finishSetup()
  await expect
    .poll(() => ports.every((port) => port.postMessage.mock.calls.length === 1))
    .toBe(true)
  for (const port of ports)
    port.onmessage!({
      data: {
        type: 'send',
        request: {
          url: 'https://api.x.com/2/users/me',
          method: 'GET',
          headers: {},
          body: new Uint8Array(),
        },
      },
    })
  await expect
    .poll(() => ports.every((port) => port.postMessage.mock.calls.length === 2))
    .toBe(true)
  expect(ports.map((port) => port.postMessage.mock.calls[1][0].transcript.sent[0])).toEqual([1, 2])
  expect(close).not.toHaveBeenCalled()
})
