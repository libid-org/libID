import { PopupError } from '@libid/popup'
import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest'
import { CeremonyError } from '../../errors.js'
import type { ProverContext } from '../../platforms/context.js'
import { platforms, supportedPlatforms } from '../../platforms/index.js'
import {
  CEREMONY_ID,
  type FakeDocumentUi,
  fakeDocumentUi,
  proveIdentity,
  returnSamples,
} from '../../testing/index.js'
import type { IdentityProof } from '../index.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { startProver } from './prover.js'

const { accept, claimRootWorker, prove } = vi.hoisted(() => ({
  accept: vi.fn(),
  claimRootWorker: vi.fn(),
  prove: vi.fn(
    async (_context: ProverContext): Promise<Omit<IdentityProof, 'type'> | null> => null,
  ),
}))

vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept },
  PopupWindow: { current: vi.fn() },
}))

vi.mock('../../assets/registration.js', () => ({ claimRootWorker }))

vi.mock('../../platforms/google/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/x/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/github/1/prover.js', () => ({ prove }))

vi.mock('./ui.js', async () => (await import('../../testing/index.js')).documentUi(() => ui))

type Spied<T, K extends keyof T> = T & Record<K, Mock>

/** The shared double; `on` and `send` are spied for handler lookups and send overrides. */
function spiedConnection(ready: 'resolved' | 'pending' = 'resolved') {
  const connection = fakeConnection({ peerOrigin: 'https://app.test', ready })
  vi.spyOn(connection, 'on')
  vi.spyOn(connection, 'send')
  return connection as Spied<FakeConnection, 'on' | 'send'>
}

let connection: ReturnType<typeof spiedConnection>
let ui: Spied<FakeDocumentUi, 'stop' | 'message' | 'trackProof' | 'finishProof' | 'delivered'>

/** The Prover document's private fragment for an OAuth return carrying `oauthFragment`. */
const proverInput = (oauthFragment = '#error=access_denied') =>
  new URLSearchParams({
    ceremonyId: CEREMONY_ID,
    applicationOrigin: 'https://app.test',
    oauthQuery: '',
    oauthFragment,
  }).toString()

/** The message types the document sent, in order. */
const sentTypes = () => connection.sent.map((message) => message.type)

beforeEach(() => {
  connection = spiedConnection()
  ui = fakeDocumentUi() as typeof ui
  for (const method of ['stop', 'message', 'trackProof', 'finishProof', 'delivered'] as const)
    vi.spyOn(ui, method)
  accept.mockImplementation(() => connection)
  vi.stubGlobal('location', { origin: 'https://ccdp.test' })
  vi.stubGlobal('crossOriginIsolated', true)
  vi.stubGlobal('Worker', vi.fn())
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it.each(supportedPlatforms)(
  'passes validated %s routing to the platform without ledger decoding [LIBID-OAUTH-021] [LIBID-BROWSER-003]',
  async (platformId) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    const { oauthReturn } = returnSamples(platformId).denied
    await startProver(
      new URLSearchParams({
        ceremonyId: CEREMONY_ID,
        applicationOrigin: 'https://app.test',
        oauthQuery: oauthReturn.query,
        oauthFragment: oauthReturn.fragment,
      }).toString(),
    )
    expect(accept).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ allowedApplicationOrigins: ['https://app.test'] }),
    )
    expect(connection.on.mock.calls.map(([codec]) => codec.type)).toEqual(['prove-identity'])
    const handler = connection.on.mock.calls.find(([codec]) => codec.type === 'prove-identity')?.[1]
    expect(connection.send).toHaveBeenCalledWith({
      type: 'event',
      event: 'prover',
      phase: 'started',
      timestamp: expect.any(Number),
    })
    handler(proveIdentity(platformId, { notaryAddress: 'https://local-notary.test' }))
    await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
    const context = prove.mock.calls[0][0]
    expect(ui.trackProof).toHaveBeenCalledExactlyOnceWith(
      platforms[platformId].versions[1].progressWeights,
    )
    expect(context.request.notaryAddress).toBe('https://local-notary.test')
    expect(context).not.toHaveProperty('ledgerId')
    expect(context.oauthReturn).toEqual(oauthReturn)
  },
)

it.each([
  { platformId: 'google', platformCeremonyVersion: 2 },
  { platformId: 'github', platformCeremonyVersion: 0 },
  { platformId: 'future', platformCeremonyVersion: 1 },
])(
  'refuses unbundled $platformId/$platformCeremonyVersion before proving [LIBID-ASSET-007] [KIT-023]',
  async (pair) => {
    await startProver(proverInput(''))
    // Exercise document dispatch directly: the wire codec also rejects unknown platforms.
    connection.on.mock.calls.find(([codec]) => codec.type === 'prove-identity')![1]({
      ...proveIdentity('google'),
      ...pair,
    })
    await vi.waitFor(() =>
      expect(ui.events).toContainEqual({
        status: 'failed',
        event: 'prover',
        message: messages.invalidProvingRequest,
        timestamp: expect.any(Number),
      }),
    )
    expect(connection.send).toHaveBeenLastCalledWith({
      type: 'ceremony-failed',
      event: 'prover',
      message: messages.invalidProvingRequest,
    })
    expect(prove).not.toHaveBeenCalled()
    expect(ui.trackProof).not.toHaveBeenCalled()
    expect(ui.stop).toHaveBeenCalledOnce()
  },
)

it.each([
  { error: new Error('Invalid GitHub id'), event: 'prover' },
  {
    error: new CeremonyError('token-attestation', 'Notarization request timed out'),
    event: 'token-attestation',
  },
])(
  'reports fallback and gracefully retires failure: $error.message [CSP-016] [LIBID-OAUTH-029] [LIBID-OAUTH-030] [LIBID-BROWSER-015] [LIBID-BROWSER-030]',
  async ({ error, event }) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test', pathname: '/ccdp/v1/prover/fallback' })
    prove.mockImplementationOnce(async (context) => {
      context.emit({ event: 'proof-worker-bootstrap', phase: 'started', timestamp: 12 })
      throw error
    })
    await startProver(proverInput())
    expect(connection.sent).toEqual([
      { type: 'event', event: 'prover-fallback', timestamp: performance.timeOrigin },
      { type: 'event', event: 'prover', phase: 'started', timestamp: expect.any(Number) },
    ])
    connection.receive(proveIdentity('github'))
    await vi.waitFor(() => expect(sentTypes()).toContain('ceremony-failed'))
    // Exactly one failure report follows the forwarded observation: no proof, no finished prover.
    expect(connection.sent.slice(2)).toEqual([
      { type: 'event', event: 'proof-worker-bootstrap', phase: 'started', timestamp: 12 },
      { type: 'ceremony-failed', event, message: error.message },
    ])
    expect(ui.events.filter((e) => e.status === 'failed')).toHaveLength(1)
    expect(prove.mock.calls[0][0].signal.aborted).toBe(true)
    expect(ui.stop).toHaveBeenCalledOnce()
  },
)

it.each(['delivered', 'send-failed', 'ui-failed', 'closed-during-paint'])(
  'gives the UI a paint opportunity before delivery: %s [LIBID-BROWSER-024]',
  async (outcome) => {
    prove.mockResolvedValueOnce({
      identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
      proof: {},
    })
    await startProver(proverInput(''))
    let painted!: () => void
    ui.finishProof.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          painted = resolve
        }),
    )
    if (outcome === 'send-failed')
      connection.send.mockImplementation((message) => {
        if (message.type === 'identity-proof') throw new Error('Delivery failed')
        connection.sent.push(message)
      })
    if (outcome === 'ui-failed') {
      ui.finishProof.mockRejectedValueOnce(new Error('UI unavailable'))
      ui.trackProof.mockImplementation(() => {
        throw new Error('UI unavailable')
      })
      ui.delivered.mockImplementation(() => {
        throw new Error('UI unavailable')
      })
    }
    connection.receive(proveIdentity())
    await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(ui.finishProof).toHaveBeenCalledOnce())
    if (outcome !== 'ui-failed') {
      expect(sentTypes()).not.toContain('identity-proof')
      if (outcome === 'closed-during-paint') connection.end()
      await Promise.resolve()
      painted()
    }
    await vi.waitFor(() => expect(ui.stop).toHaveBeenCalled())
    if (outcome === 'closed-during-paint') {
      expect(ui.delivered).not.toHaveBeenCalled()
      expect(sentTypes()).not.toContain('identity-proof')
    } else if (outcome === 'send-failed') {
      expect(ui.delivered).not.toHaveBeenCalled()
      expect(sentTypes()).toContain('ceremony-failed')
    } else {
      expect(ui.delivered).toHaveBeenCalledOnce()
      const index = sentTypes().indexOf('identity-proof')
      expect(connection.send.mock.invocationCallOrder[index]).toBeLessThan(
        ui.delivered.mock.invocationCallOrder[0],
      )
      expect(sentTypes()).not.toContain('ceremony-failed')
    }
    expect(connection.sent).not.toContainEqual(
      expect.objectContaining({ event: 'prover', phase: 'finished' }),
    )
  },
)

it.each(['before', 'after'])(
  'shows the transport failure locally %s readiness [TEST-CCDP-08]',
  async (when) => {
    const error = new PopupError('fallback-failed')
    connection = spiedConnection(when === 'before' ? 'pending' : 'resolved')
    const run = startProver(proverInput(''))
    if (when === 'after') await run
    connection.send.mockImplementation(() => {
      throw new Error('unreachable')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    connection.end({ outcome: 'failed', code: error.code })
    if (when === 'before') connection.settle(error)
    await run
    await vi.waitFor(() =>
      expect(ui.events).toContainEqual({
        status: 'failed',
        event: 'prover',
        message: popupErrorMessages[error.code],
        timestamp: expect.any(Number),
      }),
    )
    expect(prove).not.toHaveBeenCalled()
    expect(ui.stop).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
  },
)

it.each(['before-ready', 'duplicate', 'after-denial'])(
  'consumes the private return once: %s [LIBID-OAUTH-019] [LIBID-OAUTH-023]',
  async (when) => {
    connection = spiedConnection('pending')
    let finish!: () => void
    if (when !== 'before-ready')
      prove.mockImplementationOnce(
        () =>
          new Promise<null>((resolve) => {
            finish = () => resolve(null)
          }),
      )
    const run = startProver(proverInput())
    const request = proveIdentity()
    if (when === 'before-ready') {
      connection.receive(request)
      connection.settle()
      await run
      await vi.waitFor(() => expect(ui.stop).toHaveBeenCalledOnce())
      expect(prove).not.toHaveBeenCalled()
      expect(sentTypes()).not.toContain('event')
    } else {
      connection.settle()
      await run
      connection.receive(request)
      await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
      if (when === 'duplicate') {
        connection.receive(request)
        await vi.waitFor(() => expect(ui.stop).toHaveBeenCalledOnce())
        finish()
      } else {
        finish()
        await vi.waitFor(() => expect(ui.stop).toHaveBeenCalledOnce())
        connection.receive(request)
      }
      await Promise.resolve()
      expect(prove).toHaveBeenCalledOnce()
      expect(prove.mock.calls[0][0].signal.aborted).toBe(true)
    }
    const count = (type: string) => sentTypes().filter((sent) => sent === type).length
    expect(count('ceremony-failed')).toBe(when === 'after-denial' ? 0 : 1)
    expect(count('user-denied')).toBe(when === 'after-denial' ? 1 : 0)
    expect(count('identity-proof')).toBe(0)
  },
)

it('reports an unreadable Prover fragment locally without accepting a connection [LIBID-OAUTH-030]', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await startProver('ceremonyId=invalid')
  expect(accept).not.toHaveBeenCalled()
  expect(ui.views).toEqual([messages.returnToApplication('Invalid navigation fields')])
  expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
})

it.each([
  ['crossOriginIsolated', false],
  ['SharedArrayBuffer', undefined],
  ['Worker', undefined],
])(
  'refuses to prove without isolation: %s is %s [LIBID-MOD-012] [LIBID-OAUTH-010] [LIBID-BROWSER-015]',
  async (name, value) => {
    vi.stubGlobal(name, value)
    await startProver(proverInput())
    expect(connection.sent).toEqual([
      { type: 'ceremony-failed', event: 'prover', message: messages.isolationUnavailable },
    ])
    expect(claimRootWorker).not.toHaveBeenCalled()
    expect(ui.stop).toHaveBeenCalledOnce()
  },
)

it('leaves quietly when popup moves the run to the isolated fallback [LIBID-BROWSER-022]', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  connection = spiedConnection('pending')
  void startProver(proverInput())
  // Popup reports the hop, releases this page and replaces it; its `ready` stays pending.
  accept.mock.calls[0][1].onDiagnostic({ code: 'isolation-fallback', timestamp: 1 })
  connection.end()
  await connection.closed
  await new Promise((resolve) => setTimeout(resolve))
  expect(ui.events.filter((event) => event.status !== 'active')).toEqual([])
  expect(connection.sent).toEqual([])
  expect(log).not.toHaveBeenCalled()
  expect(ui.stop).not.toHaveBeenCalled()
})

it('announces no readiness when the connection ends while the root worker is claimed [LIBID-BROWSER-022]', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const claim = Promise.withResolvers<void>()
  claimRootWorker.mockReturnValueOnce(claim.promise)
  const run = startProver(proverInput())
  await vi.waitFor(() => expect(claimRootWorker).toHaveBeenCalledOnce())
  connection.end()
  claim.resolve()
  await run
  expect(ui.events).toContainEqual(
    expect.objectContaining({ status: 'failed', message: messages.proverClosed }),
  )
  // The ended connection cannot carry the report; its loss is logged locally.
  expect(connection.sent).toEqual([])
  expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
  expect(ui.stop).toHaveBeenCalledOnce()
})

it('drops prover observations produced after the document ended [LIBID-BROWSER-015] [LIBID-BROWSER-022] [LIBID-BROWSER-030]', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  prove.mockImplementationOnce(async ({ signal, emit }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve))
    emit({ event: 'proof-worker-bootstrap', phase: 'started', timestamp: 12 })
    return null
  })
  await startProver(proverInput())
  connection.receive(proveIdentity())
  await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
  connection.end()
  await prove.mock.results[0].value
  expect(ui.events).toContainEqual(
    expect.objectContaining({ status: 'failed', message: messages.proverClosed }),
  )
  expect(connection.sent).toEqual([
    { type: 'event', event: 'prover', phase: 'started', timestamp: expect.any(Number) },
  ])
  expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
  expect(ui.events).not.toContainEqual(expect.objectContaining({ event: 'proof-worker-bootstrap' }))
})

it.each([
  { event: 'proof-worker-bootstrap', core: false },
  { event: 'token-fetch', core: true },
])('fails proving only when a core observation cannot be sent: $event', async ({ event, core }) => {
  connection.send.mockImplementation((message) => {
    if (message.type === 'event' && message.event === event) throw new Error('observation lost')
    connection.sent.push(message)
  })
  prove.mockImplementationOnce(async ({ emit }) => {
    emit({ event, phase: 'started', timestamp: 12 })
    return null
  })
  await startProver(proverInput())
  connection.receive(proveIdentity('github'))
  await vi.waitFor(() => expect(ui.stop).toHaveBeenCalledOnce())
  expect(connection.sent.slice(1)).toEqual([
    core
      ? { type: 'ceremony-failed', event: 'prover', message: 'observation lost' }
      : { type: 'user-denied' },
  ])
  // A lost extension observation still reaches local observers; a core loss ends the run.
  expect(ui.events.some((e) => 'event' in e && e.event === event)).toBe(!core)
})
