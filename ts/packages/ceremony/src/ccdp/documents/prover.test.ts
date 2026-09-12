import { afterEach, expect, it, vi } from 'vitest'
import type { ProverContext } from '../../platforms/context.js'
import { startProver } from './prover.js'

const { connection, prove } = vi.hoisted(() => ({
  connection: {
    ready: Promise.resolve(),
    closed: new Promise(() => {}),
    send: vi.fn(),
    on: vi.fn(),
  },
  prove: vi.fn(async (_context: ProverContext) => null),
}))

vi.mock('@libid/popup', () => ({
  PopupConnection: { accept: () => connection },
  PopupWindow: { current: vi.fn() },
}))

vi.mock('virtual:ceremony-popup-fallback', () => ({ fallback: undefined }))

vi.mock('../../assets/registration.js', () => ({ claimRootWorker: vi.fn() }))

vi.mock('../../platforms/google/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/x/1/prover.js', () => ({ prove }))

vi.mock('../../platforms/github/1/prover.js', () => ({ prove }))

vi.mock('./ui.js', () => ({
  view: vi.fn(),
  eventView: () => ({ stop: vi.fn(), message: vi.fn() }),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it.each(['google', 'x', 'github'])(
  'passes validated %s routing to the platform without ledger decoding [LIBID-OAUTH-021]',
  async (platformId) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    await startProver(
      new URLSearchParams({
        ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
        oauthQuery: '',
        oauthFragment: '#error=access_denied',
      }).toString(),
    )
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
      notaryAddress: platformId === 'google' ? null : 'https://local-notary.test',
    })
    await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
    const context = prove.mock.calls[0][0]
    expect(context.request.notaryAddress).toBe(
      platformId === 'google' ? null : 'https://local-notary.test',
    )
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
      type: 'abort',
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
