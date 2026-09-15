import { type ConnectionEnd, PopupError } from '@libid/popup'
import { afterEach, expect, it, vi } from 'vitest'
import type { Events } from '../../events.js'
import type { ProverContext } from '../../platforms/context.js'
import { platforms } from '../../platforms/index.js'
import type { IdentityProof } from '../index.js'
import { popupErrorMessages } from '../ui-messages.js'
import { startProver } from './prover.js'

const { accept, connection, prove, ui, terminal } = vi.hoisted(() => ({
  accept: vi.fn(),
  terminal: vi.fn(),
  connection: {
    ready: Promise.resolve(),
    closed: new Promise<ConnectionEnd>(() => {}),
    send: vi.fn(),
    on: vi.fn(),
  },
  prove: vi.fn(
    async (_context: ProverContext): Promise<Omit<IdentityProof, 'type'> | null> => null,
  ),
  ui: {
    stop: vi.fn(),
    message: vi.fn(),
    trackProof: vi.fn(),
    finishProof: vi.fn(),
    delivered: vi.fn(),
  },
}))

vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: {
    accept: (...args: unknown[]) => {
      accept(...args)
      return connection
    },
  },
  PopupWindow: { current: vi.fn() },
}))

vi.mock('virtual:ceremony-popup-fallback', () => ({ fallback: undefined }))

vi.mock('../../assets/registration.js', () => ({ claimRootWorker: vi.fn() }))

vi.mock('../../platforms/google/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/x/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/github/1/prover.js', () => ({ prove }))

vi.mock('./ui.js', () => ({
  view: vi.fn(),
  eventView: (events: Events) => {
    events.onEvent(terminal)
    return ui
  },
}))

afterEach(() => {
  vi.clearAllMocks()
  connection.closed = new Promise(() => {})
  connection.ready = Promise.resolve()
  connection.send.mockReset()
  ui.trackProof.mockReset()
  ui.finishProof.mockReset()
  ui.delivered.mockReset()
  vi.unstubAllGlobals()
})

it.each(['google', 'x', 'github'] as const)(
  'passes validated %s routing to the platform without ledger decoding [LIBID-OAUTH-021]',
  async (platformId) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    await startProver(
      new URLSearchParams({
        ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
        applicationOrigin: 'https://app.test',
        oauthQuery: '',
        oauthFragment: '#error=access_denied',
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
    handler({
      type: 'prove-identity',
      platformId,
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: 'https://bridge.test/callback',
      codeVerifier: null,
      notaryAddress: 'https://local-notary.test',
    })
    await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
    const context = prove.mock.calls[0][0]
    expect(ui.trackProof).toHaveBeenCalledExactlyOnceWith(
      platforms[platformId].versions[1].progressWeights,
    )
    expect(context.request.notaryAddress).toBe('https://local-notary.test')
    expect(context).not.toHaveProperty('ledgerId')
    expect(context.oauthReturn.fragment).toBe('#error=access_denied')
  },
)

it('reports retrospective fallback before readiness and preserves producer timestamps [CSP-016]', async () => {
  vi.stubGlobal('location', { origin: 'https://ccdp.test', pathname: '/ccdp/v1/prover/fallback' })
  vi.stubGlobal('crossOriginIsolated', true)
  vi.stubGlobal('Worker', vi.fn())
  prove.mockImplementationOnce(async (context) => {
    context.emit({ event: 'proof-worker-bootstrap', phase: 'started', timestamp: 12 })
    throw new Error('Invalid GitHub id')
  })
  await startProver(
    new URLSearchParams({
      ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
      applicationOrigin: 'https://app.test',
      oauthQuery: '',
      oauthFragment: '#error=access_denied',
    }).toString(),
  )
  expect(connection.send.mock.calls.slice(0, 2).map(([m]) => m)).toEqual([
    { type: 'event', event: 'prover-fallback', timestamp: performance.timeOrigin },
    { type: 'event', event: 'prover', phase: 'started', timestamp: expect.any(Number) },
  ])
  connection.on.mock.calls.find(([codec]) => codec.type === 'prove-identity')![1]({
    type: 'prove-identity',
    platformId: 'github',
    platformCeremonyVersion: 1,
  })
  await vi.waitFor(() =>
    expect(connection.send).toHaveBeenCalledWith({
      type: 'ceremony-failed',
      event: 'prover',
      message: 'Invalid GitHub id',
    }),
  )
  expect(connection.send).toHaveBeenCalledWith({
    type: 'event',
    event: 'proof-worker-bootstrap',
    phase: 'started',
    timestamp: 12,
  })
  expect(
    connection.send.mock.calls.some(([m]) => m.event === 'prover' && m.phase === 'finished'),
  ).toBe(false)
})

it.each(['delivered', 'send-failed', 'ui-failed', 'closed-during-paint'])(
  'gives the UI a paint opportunity before delivery: %s [LIBID-BROWSER-024]',
  async (outcome) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    let close!: () => void
    connection.closed = new Promise<ConnectionEnd>((resolve) => {
      close = () => resolve({ outcome: 'closed' })
    })
    prove.mockResolvedValueOnce({
      identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
      proof: {},
    })
    await startProver(
      new URLSearchParams({
        ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
        applicationOrigin: 'https://app.test',
        oauthQuery: '',
        oauthFragment: '',
      }).toString(),
    )
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
    connection.on.mock.calls.find(([codec]) => codec.type === 'prove-identity')![1]({
      type: 'prove-identity',
      platformId: 'google',
      platformCeremonyVersion: 1,
    })
    await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(ui.finishProof).toHaveBeenCalledOnce())
    if (outcome !== 'ui-failed') {
      expect(connection.send.mock.calls.some(([m]) => m.type === 'identity-proof')).toBe(false)
      if (outcome === 'closed-during-paint') close()
      await Promise.resolve()
      painted()
    }
    await vi.waitFor(() => expect(ui.stop).toHaveBeenCalled())
    if (outcome === 'closed-during-paint') {
      expect(ui.delivered).not.toHaveBeenCalled()
      expect(connection.send.mock.calls.some(([m]) => m.type === 'identity-proof')).toBe(false)
    } else if (outcome === 'send-failed') {
      expect(ui.delivered).not.toHaveBeenCalled()
      expect(connection.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ceremony-failed' }),
      )
    } else {
      expect(ui.delivered).toHaveBeenCalledOnce()
      const index = connection.send.mock.calls.findIndex(
        ([message]) => message.type === 'identity-proof',
      )
      expect(connection.send.mock.invocationCallOrder[index]).toBeLessThan(
        ui.delivered.mock.invocationCallOrder[0],
      )
      expect(
        connection.send.mock.calls.some(([message]) => message.type === 'ceremony-failed'),
      ).toBe(false)
    }
    expect(
      connection.send.mock.calls.some(
        ([message]) => message.event === 'prover' && message.phase === 'finished',
      ),
    ).toBe(false)
  },
)

it.each(['before', 'after'])(
  'shows the transport failure locally %s readiness [TEST-CCDP-08]',
  async (when) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    const error = new PopupError('fallback-failed')
    let close!: (end: ConnectionEnd) => void
    connection.closed = new Promise<ConnectionEnd>((resolve) => {
      close = resolve
    })
    let rejectReady!: (error: Error) => void
    if (when === 'before')
      connection.ready = new Promise<void>((_, reject) => {
        rejectReady = reject
      })
    const run = startProver(
      new URLSearchParams({
        ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
        applicationOrigin: 'https://app.test',
        oauthQuery: '',
        oauthFragment: '',
      }).toString(),
    )
    if (when === 'after') await run
    connection.send.mockImplementation(() => {
      throw new Error('unreachable')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      close({ outcome: 'failed', code: error.code })
      if (when === 'before') rejectReady(error)
      await run
      await vi.waitFor(() =>
        expect(terminal).toHaveBeenCalledWith({
          status: 'failed',
          event: 'prover',
          message: popupErrorMessages[error.code],
          timestamp: expect.any(Number),
        }),
      )
      expect(prove).not.toHaveBeenCalled()
      expect(ui.stop).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
    } finally {
      log.mockRestore()
    }
  },
)
