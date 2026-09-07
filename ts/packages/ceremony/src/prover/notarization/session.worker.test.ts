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
      url: 'https://api.x.com/2/users/me',
      moduleUrl: `data:text/javascript,${encodeURIComponent(source)}`,
      wasmUrl: 'unused',
      notaryAddress: 'https://notary.test',
    },
  })
  await expect.poll(() => postMessage.mock.calls.some(([m]) => m.type === 'prepared')).toBe(true)
  receive({
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
  return { postMessage, close, receive }
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
