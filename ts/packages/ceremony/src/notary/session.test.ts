import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventMessage } from '../ccdp/index.js'
import type { OperationEvent } from '../events.js'
import { exactRequest } from '../testing/index.js'
import { type FakeWorker, stubWorkers } from '../testing/workers.js'
import { LIBID_RS_ATTESTED_DATA } from './fixtures/libid-rs.js'
import type { Prepare, Transcript } from './protocol.js'
import { NotaryRuntime, type NotarySession } from './session.js'

vi.mock('../assets/index.js', async (original) => ({
  ...(await original<typeof import('../assets/index.js')>()),
  assetUrl: () => 'https://ccdp.test/asset',
}))

const target = 'https://api.x.com/2/users/me'

const request = exactRequest(target)

const empty: Transcript = { sent: new Uint8Array(), received: new Uint8Array() }

let workers: FakeWorker[]

/** Every prepare message sent to the shared worker, in order. */
const prepares = (): Prepare[] =>
  workers.flatMap((worker) => worker.postMessage.mock.calls.map(([message]) => message))

/** The worker end of each session's channel, in prepare order. */
const ports = () => prepares().map((message) => message.port)

beforeEach(() => {
  workers = stubWorkers()
})

afterEach(() => {
  for (const port of ports()) port.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Prepare a session, answering `prepared` and then its send with `transcript`. */
async function sentSession(notary: NotaryRuntime, attestation?: string, transcript = empty) {
  const ready = notary.prepare(
    target,
    attestation === undefined ? undefined : { fetch: 'token-fetch', attestation },
  )
  const port = ports().at(-1)!
  port.postMessage({ type: 'initialized' })
  port.postMessage({ type: 'prepared' })
  const session = await ready
  const sent = session.send(request)
  port.postMessage({ type: 'sent', transcript })
  await sent
  return { session, port }
}

/** Reveal nothing and answer with no openings, resolving to the result awaiting attestation. */
function revealNothing(session: NotarySession, port: MessagePort) {
  const revealing = session.reveal({ sent: [], received: [] })
  port.postMessage({ type: 'revealed', openings: [] })
  return revealing
}

it.each(['https://notary.lib.id', 'https://testnet.notary.lib.id', 'https://localhost:4687'])(
  'starts the selected notary only, without retrying another network: %s [LIBID-PROVER-008]',
  async (notaryAddress) => {
    const pending = new NotaryRuntime(notaryAddress, new AbortController().signal).prepare(target)
    ports()[0].postMessage({ type: 'error' })
    await expect(pending).rejects.toThrow('Notarization failed')
    expect(workers).toHaveLength(1)
    expect(prepares()).toEqual([expect.objectContaining({ type: 'prepare', notaryAddress })])
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  },
)

it('rejects invalid origins, targets and pre-aborted work before creating a worker', async () => {
  for (const address of ['http://notary.test', 'https://notary.test/', 'https://notary.test/path'])
    expect(() => new NotaryRuntime(address, new AbortController().signal)).toThrow()
  const notary = new NotaryRuntime('https://notary.test', new AbortController().signal)
  for (const url of ['http://api.x.com/', 'https://api.x.com/#fragment', 'https://api.x.com:444/'])
    await expect(notary.prepare(url)).rejects.toThrow('Invalid notarization target')
  expect(() => new NotaryRuntime('https://notary.test', AbortSignal.abort())).toThrow()
  expect(workers).toHaveLength(0)
})

it('shares one worker, routes overlapping replies per session and keeps it alive until ceremony cleanup', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const notary = new NotaryRuntime('https://notary.test', abort.signal)
  const first = notary.prepare(target),
    second = notary.prepare(target)
  expect(workers).toHaveLength(1)
  const [{ terminate }] = workers
  const [one, two] = ports()
  two.postMessage({ type: 'initialized' })
  two.postMessage({ type: 'prepared' })
  one.postMessage({ type: 'initialized' })
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
  const result = await revealNothing(token, one)
  one.postMessage({ type: 'attestation', attestation: { fixture: 'token' } })
  await expect(result.attestation).resolves.toEqual({ fixture: 'token' })
  expect(terminate).not.toHaveBeenCalled()
  // The other session still works after the first releases its message channel.
  const final = await revealNothing(identity, two)
  two.postMessage({ type: 'attestation', attestation: { fixture: 'identity' } })
  await expect(final.attestation).resolves.toEqual({ fixture: 'identity' })
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(10000)
  expect(terminate).not.toHaveBeenCalled()
  abort.abort()
  expect(terminate).toHaveBeenCalledOnce()
  await expect(notary.prepare(target)).rejects.toThrow()
})

it('posts the exact request once and fails a send to another URL before sending [LIBID-PROVER-017]', async () => {
  const abort = new AbortController()
  const notary = new NotaryRuntime('https://notary.test', abort.signal)
  const ready = notary.prepare(target)
  const port = ports()[0]
  const received: unknown[] = []
  port.onmessage = (event) => received.push(event.data)
  port.postMessage({ type: 'initialized' })
  port.postMessage({ type: 'prepared' })
  const session = await ready
  await expect(session.reveal({ sent: [], received: [] })).rejects.toThrow(
    'Invalid notarization reveal',
  )
  await expect(session.send(exactRequest('https://api.x.com/2/oauth2/token'))).rejects.toThrow(
    'Invalid notarization send',
  )
  // Rejected calls neither reach the worker nor retire the prepared session.
  expect(notary.signal.aborted).toBe(false)
  const withBody = exactRequest(target, { method: 'POST', body: new Uint8Array([1]) })
  const sent = session.send(withBody)
  await expect(session.send(request)).rejects.toThrow('Invalid notarization send')
  await vi.waitFor(() => expect(received).toEqual([{ type: 'send', request: withBody }]))
  port.postMessage({ type: 'sent', transcript: empty })
  await expect(sent).resolves.toEqual(empty)
  expect(workers[0].terminate).not.toHaveBeenCalled()
  abort.abort()
})

it.each(['abort', 'session-error'])(
  '%s rejects sibling preparation and pending attestations and terminates the shared worker',
  async (failure) => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const events: OperationEvent[] = []
    const notary = new NotaryRuntime('https://notary.test', abort.signal, (event) =>
      events.push(event),
    )
    const { session, port } = await sentSession(notary, 'token-attestation')
    const { attestation } = await revealNothing(session, port)
    const pending = notary.prepare(target)
    const checks = Promise.all(
      [attestation, pending].map((result) =>
        failure === 'session-error'
          ? expect(result).rejects.toMatchObject({ event: 'token-attestation' })
          : expect(result).rejects.toThrow(),
      ),
    )
    if (failure === 'abort') abort.abort()
    else port.postMessage({ type: 'error' })
    await checks
    expect(events).toEqual([
      expect.objectContaining({ event: 'token-attestation', phase: 'started' }),
    ])
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await expect(session.send(request)).rejects.toThrow()
  },
)

it('fails a stuck preparation as the fetch it would start, within 10 seconds [LIBID-BROWSER-010]', async () => {
  vi.useFakeTimers()
  const notary = new NotaryRuntime('https://notary.test', new AbortController().signal)
  const stuck = notary.prepare(target, { fetch: 'token-fetch', attestation: 'token-attestation' })
  const rejection = expect(stuck).rejects.toMatchObject({
    event: 'token-fetch',
    message: 'Notary preparation timed out',
  })
  // Loading the runtime, however slow the download, has no deadline.
  await vi.advanceTimersByTimeAsync(60000)
  expect(notary.signal.aborted).toBe(false)
  ports().at(-1)!.postMessage({ type: 'initialized' })
  await vi.advanceTimersByTimeAsync(9999)
  expect(notary.signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await rejection
  expect(notary.signal.aborted).toBe(true)
  // A prepared session's deadline starts only when it sends.
  const idle = new NotaryRuntime('https://notary.test', new AbortController().signal)
  const ready = idle.prepare(target)
  ports().at(-1)!.postMessage({ type: 'initialized' })
  ports().at(-1)!.postMessage({ type: 'prepared' })
  await ready
  await vi.advanceTimersByTimeAsync(60000)
  expect(idle.signal.aborted).toBe(false)
})

it('exposes late worker failure after preparation through the runtime signal [LIBID-PROVER-018]', async () => {
  const parent = new AbortController()
  const notary = new NotaryRuntime('https://notary.test', parent.signal)
  const prepared = notary.prepare(target)
  ports()[0].postMessage({ type: 'initialized' })
  ports()[0].postMessage({ type: 'prepared' })
  const session = await prepared
  expect(notary.signal.aborted).toBe(false)
  workers[0].crash({ message: 'Notary worker failed' })
  expect(notary.signal.aborted).toBe(true)
  expect(notary.signal.reason).toMatchObject({ message: 'Notary worker failed' })
  expect(parent.signal.aborted).toBe(false)
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  await expect(session.send(request)).rejects.toMatchObject({ message: 'Notary worker failed' })
})

it.each([
  { event: 'token-attestation', headerBytes: 19 },
  { event: 'identity-attestation', headerBytes: 26 },
  { event: 'token-attestation', headerBytes: undefined },
])(
  'measures $event openings separately from finalization and forwards the worker response measures ($headerBytes header bytes) without exposing evidence or blocking delivery [LIBID-PROVER-007]',
  async ({ event, headerBytes }) => {
    let clock = 0
    vi.stubGlobal('performance', { timeOrigin: 10000, now: () => clock })
    const events: OperationEvent[] = []
    const abort = new AbortController()
    const notary = new NotaryRuntime('https://notary.test', abort.signal, (event) => {
      events.push(event)
      throw new Error('Broken diagnostic observer')
    })
    try {
      const { session, port } = await sentSession(notary, event, {
        sent: new Uint8Array(60),
        received: new Uint8Array(40),
      })
      clock = 10
      const pending = session.reveal({ sent: [], received: [] })
      clock = 160
      port.postMessage({ type: 'revealed', openings: [] })
      const revealed = await pending
      expect(events).toEqual([{ event, phase: 'started', timestamp: 10010 }])
      const attestation = {
        attestedData: LIBID_RS_ATTESTED_DATA,
        signature: new Uint8Array(65),
      }
      // The worker measures the response; the parent forwards it with its intervals.
      const measured = {
        'sent-bytes': 60,
        'received-bytes': 40,
        ...(headerBytes === undefined
          ? {}
          : { 'response-header-bytes': headerBytes, 'response-body-bytes': 40 - headerBytes }),
        'committed-sent-bytes': 20,
        'committed-received-bytes': 30,
        'commitment-count': 2,
      }
      clock = 190
      port.postMessage({ type: 'attestation', attestation, attributes: measured })
      await expect(revealed.attestation).resolves.toEqual(attestation)
      expect(events).toEqual([
        { event, phase: 'started', timestamp: 10010 },
        {
          event,
          phase: 'finished',
          timestamp: 10190,
          instrumentation: {
            attributes: { 'openings-ms': 150, 'finalization-ms': 30, ...measured },
          },
        },
      ])
      for (const emitted of events)
        expect(() => EventMessage.decode({ type: 'event', ...emitted })).not.toThrow()
    } finally {
      abort.abort()
    }
  },
)

it("names the failed session's own operation in the siblings its failure aborts", async () => {
  const notary = new NotaryRuntime('https://notary.test', new AbortController().signal)
  const token = notary.prepare(target, { fetch: 'token-fetch', attestation: 'token-attestation' })
  const identity = notary.prepare(target, {
    fetch: 'identity-fetch',
    attestation: 'identity-attestation',
  })
  const [, identityPort] = ports()
  identityPort.postMessage({ type: 'error', message: 'identity setup failed' })
  const failure = {
    name: 'CeremonyError',
    event: 'identity-fetch',
    message: 'identity setup failed',
  }
  await expect(identity).rejects.toMatchObject(failure)
  await expect(token).rejects.toMatchObject(failure)
})

it('rejects reveal when its start event synchronously aborts the session', async () => {
  const abort = new AbortController()
  const reason = new Error('Connection ended during event forwarding')
  const notary = new NotaryRuntime('https://notary.test', abort.signal, () => abort.abort(reason))
  const { session } = await sentSession(notary, 'token-attestation')
  await expect(session.reveal({ sent: [], received: [] })).rejects.toBe(reason)
  expect(workers[0].terminate).toHaveBeenCalledOnce()
})

it.each(['send', 'reveal', 'attestation'])(
  '%s stalls share one 10-second request deadline and abort sibling work [LIBID-BROWSER-010]',
  async (stage) => {
    vi.useFakeTimers()
    const notary = new NotaryRuntime('https://notary.test', new AbortController().signal)
    const ready = notary.prepare(target)
    // Neither cold preparation (bounded on its own) nor an idle session waiting for its bearer
    // uses the budget.
    await vi.advanceTimersByTimeAsync(9999)
    expect(notary.signal.aborted).toBe(false)
    const port = ports()[0]
    port.postMessage({ type: 'initialized' })
    port.postMessage({ type: 'prepared' })
    const session = await ready
    await vi.advanceTimersByTimeAsync(10000)
    expect(notary.signal.aborted).toBe(false)
    const sent = session.send(request)
    const sibling = notary.prepare(target)
    let pending: Promise<unknown> = sent
    await vi.advanceTimersByTimeAsync(5000)
    if (stage !== 'send') {
      port.postMessage({ type: 'sent', transcript: empty })
      await sent
      const revealing = session.reveal({ sent: [], received: [] })
      pending = revealing
      if (stage === 'attestation') {
        port.postMessage({ type: 'revealed', openings: [] })
        pending = (await revealing).attestation
      }
    }
    const checks = Promise.all([
      expect(pending).rejects.toThrow('Notarization request timed out'),
      expect(sibling).rejects.toThrow('Notarization request timed out'),
    ])
    await vi.advanceTimersByTimeAsync(4999)
    expect(notary.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await checks
    expect(notary.signal.aborted).toBe(true)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await expect(session.send(request)).rejects.toThrow('Notarization request timed out')
  },
)

it('rejects a final attestation before openings instead of leaving reveal pending', async () => {
  vi.useFakeTimers()
  const notary = new NotaryRuntime('https://notary.test', new AbortController().signal)
  const { session, port } = await sentSession(notary)
  const revealing = session.reveal({ sent: [], received: [] })
  port.postMessage({ type: 'attestation', attestation: {} })
  await expect(revealing).rejects.toThrow('Unexpected notarization result')
  expect(notary.signal.aborted).toBe(true)
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
