import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { type OperationEvent, validateEvent } from '../events.js'
import { decodeAttestedData } from './decode.js'
import { type ExactHttpRequest, Notarization } from './session.js'

vi.mock('virtual:ceremony-assets', () => ({ urls: {} }))

vi.mock('../assets/index.js', async (original) => ({
  ...(await original<typeof import('../assets/index.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))

const ports: MessagePort[] = []

afterEach(() => {
  for (const port of ports.splice(0)) port.close()
  vi.unstubAllGlobals()
})

function runtime() {
  const messages: { type: string; url: string; notaryAddress: string; port: MessagePort }[] = []
  const terminate = vi.fn()
  const worker = vi.fn(() => ({
    terminate,
    postMessage(message: (typeof messages)[number]) {
      messages.push(message)
      ports.push(message.port)
    },
  }))
  vi.stubGlobal('Worker', worker)
  return { messages, terminate, worker }
}

const target = 'https://api.x.com/2/users/me'

const request: ExactHttpRequest = {
  url: target,
  method: 'GET',
  headers: {},
  body: new Uint8Array(),
}

it.each(['https://notary.lib.id', 'https://testnet.notary.lib.id', 'https://localhost:4687'])(
  'starts the selected notary only, without retrying another network: %s [LIBID-PROVER-008]',
  async (notaryAddress) => {
    const { messages, terminate } = runtime()
    const pending = new Notarization(notaryAddress, new AbortController().signal).prepare(target)
    messages[0].port.postMessage({ type: 'error' })
    await expect(pending).rejects.toThrow('Notarization failed')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'prepare', notaryAddress })
    expect(terminate).toHaveBeenCalledOnce()
  },
)

it('rejects invalid origins, targets and pre-aborted work before creating a worker', async () => {
  const { worker } = runtime()
  for (const address of ['http://notary.test', 'https://notary.test/', 'https://notary.test/path'])
    expect(() => new Notarization(address, new AbortController().signal)).toThrow()
  const notary = new Notarization('https://notary.test', new AbortController().signal)
  for (const url of ['http://api.x.com/', 'https://api.x.com/#fragment', 'https://api.x.com:444/'])
    await expect(notary.prepare(url)).rejects.toThrow('Invalid notarization target')
  expect(() => new Notarization('https://notary.test', AbortSignal.abort())).toThrow()
  expect(worker).not.toHaveBeenCalled()
})

it('shares one worker, routes overlapping replies per session and keeps it alive until ceremony cleanup', async () => {
  const { messages, worker, terminate } = runtime()
  const abort = new AbortController()
  const notary = new Notarization('https://notary.test', abort.signal)
  const first = notary.prepare(target),
    second = notary.prepare(target)
  expect(worker).toHaveBeenCalledOnce()
  const [one, two] = messages.map((message) => message.port)
  two.postMessage({ type: 'prepared' })
  one.postMessage({ type: 'prepared' })
  const [token, identity] = await Promise.all([first, second])
  const a = token.send(request),
    b = identity.send(request)
  const transcript = (value: number) => ({
    sent: new Uint8Array([value]),
    received: new Uint8Array(),
  })
  two.postMessage({ type: 'sent', transcript: transcript(2) })
  one.postMessage({ type: 'sent', transcript: transcript(1) })
  await expect(a).resolves.toEqual(transcript(1))
  await expect(b).resolves.toEqual(transcript(2))
  const reveal = token.reveal({ sent: [], received: [] })
  one.postMessage({ type: 'revealed', openings: [] })
  const result = await reveal
  one.postMessage({ type: 'attestation', attestation: { fixture: 'token' } })
  await expect(result.attestation).resolves.toEqual({ fixture: 'token' })
  expect(terminate).not.toHaveBeenCalled()
  // The other session still works after the first releases its message channel.
  const other = identity.reveal({ sent: [], received: [] })
  two.postMessage({ type: 'revealed', openings: [] })
  const final = await other
  two.postMessage({ type: 'attestation', attestation: { fixture: 'identity' } })
  await expect(final.attestation).resolves.toEqual({ fixture: 'identity' })
  expect(terminate).not.toHaveBeenCalled()
  abort.abort()
  expect(terminate).toHaveBeenCalledOnce()
  await expect(notary.prepare(target)).rejects.toThrow()
})

it.each(['abort', 'session-error'])(
  '%s rejects sibling preparation and pending attestations and terminates the shared worker',
  async (failure) => {
    const { messages, terminate } = runtime()
    const abort = new AbortController()
    const events: OperationEvent[] = []
    const notary = new Notarization('https://notary.test', abort.signal, (event) =>
      events.push(event),
    )
    const ready = notary.prepare(target, 'token-attestation')
    const port = messages[0].port
    port.postMessage({ type: 'prepared' })
    const session = await ready
    const sent = session.send(request)
    port.postMessage({
      type: 'sent',
      transcript: { sent: new Uint8Array(), received: new Uint8Array() },
    })
    await sent
    const revealing = session.reveal({ sent: [], received: [] })
    port.postMessage({ type: 'revealed', openings: [] })
    const { attestation } = await revealing
    const pending = notary.prepare(target)
    const checks = Promise.all([
      expect(attestation).rejects.toThrow(),
      expect(pending).rejects.toThrow(),
    ])
    if (failure === 'abort') abort.abort()
    else port.postMessage({ type: 'error' })
    await checks
    expect(events).toEqual([
      expect.objectContaining({ event: 'token-attestation', phase: 'started' }),
    ])
    expect(terminate).toHaveBeenCalledOnce()
    await expect(session.send(request)).rejects.toThrow()
  },
)

it('exposes late worker failure after preparation through the runtime signal [LIBID-PROVER-018]', async () => {
  const { messages, worker, terminate } = runtime()
  const parent = new AbortController()
  const notary = new Notarization('https://notary.test', parent.signal)
  const prepared = notary.prepare(target)
  messages[0].port.postMessage({ type: 'prepared' })
  const session = await prepared
  expect(notary.signal.aborted).toBe(false)
  worker.mock.results[0].value.onerror({ message: 'Notary worker failed' })
  expect(notary.signal.aborted).toBe(true)
  expect(notary.signal.reason).toMatchObject({ message: 'Notary worker failed' })
  expect(parent.signal.aborted).toBe(false)
  expect(terminate).toHaveBeenCalledOnce()
  await expect(session.send(request)).rejects.toMatchObject({ message: 'Notary worker failed' })
})

it.each([
  { event: 'token-attestation', response: 'HTTP/1.1 200 OK\r\n\r\n\r\n\r\n', headerBytes: 19 },
  { event: 'identity-attestation', response: 'HTTP/1.1 200 OK\r\nX: é\r\n\r\n', headerBytes: 26 },
  { event: 'token-attestation', response: 'No header boundary', headerBytes: undefined },
])(
  'measures $event response $response and openings separately from finalization without exposing evidence or blocking delivery [LIBID-PROVER-007]',
  async ({ event, response, headerBytes }) => {
    let clock = 0
    vi.stubGlobal('performance', { timeOrigin: 10000, now: () => clock })
    const { messages } = runtime()
    const events: OperationEvent[] = []
    const abort = new AbortController()
    const notary = new Notarization('https://notary.test', abort.signal, (event) => {
      events.push(event)
      throw new Error('Broken diagnostic observer')
    })
    try {
      const ready = notary.prepare(target, event)
      const port = messages[0].port
      port.postMessage({ type: 'prepared' })
      const session = await ready
      const sent = session.send(request)
      const received = new Uint8Array(40)
      received.set(new TextEncoder().encode(response))
      port.postMessage({
        type: 'sent',
        transcript: { sent: new Uint8Array(60), received },
      })
      await sent
      clock = 10
      const pending = session.reveal({ sent: [], received: [] })
      clock = 160
      port.postMessage({ type: 'revealed', openings: [] })
      const revealed = await pending
      expect(events).toEqual([{ event, phase: 'started', timestamp: 10010 }])
      const attestedData = Uint8Array.from(
        Buffer.from(
          readFileSync(
            new URL('./libid-rs-239a4bb-attested-data.fixture.hex', import.meta.url),
            'utf8',
          ).trim(),
          'hex',
        ),
      )
      const attestation = {
        attestedData,
        signature: new Uint8Array(65),
        decoded: decodeAttestedData(attestedData),
      }
      clock = 190
      port.postMessage({ type: 'attestation', attestation })
      await expect(revealed.attestation).resolves.toEqual(attestation)
      expect(events).toEqual([
        { event, phase: 'started', timestamp: 10010 },
        {
          event,
          phase: 'finished',
          timestamp: 10190,
          instrumentation: {
            attributes: {
              'openings-ms': 150,
              'finalization-ms': 30,
              'sent-bytes': 60,
              'received-bytes': 40,
              ...(headerBytes === undefined
                ? {}
                : {
                    'response-header-bytes': headerBytes,
                    'response-body-bytes': 40 - headerBytes,
                  }),
              'committed-sent-bytes': 20,
              'committed-received-bytes': 30,
              'commitment-count': 2,
            },
          },
        },
      ])
      for (const emitted of events) expect(() => validateEvent(emitted)).not.toThrow()
    } finally {
      abort.abort()
    }
  },
)

it('rejects reveal when its start event synchronously aborts the session', async () => {
  const { messages, terminate } = runtime()
  const abort = new AbortController()
  const reason = new Error('Connection ended during event forwarding')
  const notary = new Notarization('https://notary.test', abort.signal, () => abort.abort(reason))
  const ready = notary.prepare(target, 'token-attestation')
  const port = messages[0].port
  port.postMessage({ type: 'prepared' })
  const session = await ready
  const sent = session.send(request)
  port.postMessage({
    type: 'sent',
    transcript: { sent: new Uint8Array(), received: new Uint8Array() },
  })
  await sent
  await expect(session.reveal({ sent: [], received: [] })).rejects.toBe(reason)
  expect(terminate).toHaveBeenCalledOnce()
})
