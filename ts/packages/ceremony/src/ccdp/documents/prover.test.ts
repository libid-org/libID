import { afterEach, expect, it, vi } from 'vitest'
import type { ProverContext } from '../../prover/context.js'
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
vi.mock('../../prefetch/registration.js', () => ({ claimRootWorker: vi.fn() }))
vi.mock('../../platforms/google/1/prover.js', () => ({ prove }))
vi.mock('../../platforms/x/1/prover.js', () => ({ prove }))
vi.mock('../../platforms/github/1/prover.js', () => ({ prove }))
vi.mock('../../ui.js', () => ({
  view: vi.fn(),
  progressView: () => ({ stop: vi.fn(), update: vi.fn() }),
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
    const handler = connection.on.mock.calls.find(
      ([codec]) => codec.type === 'app-start-prover',
    )?.[1]
    expect(connection.send).toHaveBeenCalledWith({ type: 'prover-ready' })
    handler({
      type: 'app-start-prover',
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

it.each(['google', 'x', 'github'])(
  'forwards %s stage milestones while proof steps remain independent',
  async (platformId) => {
    vi.stubGlobal('location', { origin: 'https://ccdp.test' })
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('Worker', vi.fn())
    prove.mockImplementationOnce(async (context) => {
      if (platformId !== 'google') {
        context.onStage('identity-fetch')
        context.onStage('proof-preparation')
      }
      context.onProgress(
        { code: 'witness', label: 'Generating witness', status: 'started', progress: 0.2 },
        1,
      )
      context.onProgress(
        {
          code: 'proof-backend-destroy',
          label: 'Finishing proof',
          status: 'completed',
          progress: 0.95,
        },
        2,
      )
      return null
    })
    await startProver(
      new URLSearchParams({
        ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
        oauthQuery: '',
        oauthFragment: '#error=access_denied',
      }).toString(),
    )
    connection.on.mock.calls.find(([codec]) => codec.type === 'app-start-prover')![1]({
      type: 'app-start-prover',
      platformId,
      platformCeremonyVersion: 1,
    })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ type: 'cancel-ceremony' }),
    )
    const events = connection.send.mock.calls.map(([event]) => event)
    expect(events.filter((e) => 'stage' in e).map((e) => e.stage)).toEqual(
      platformId === 'google'
        ? ['proof-generation']
        : ['identity-fetch', 'proof-preparation', 'proof-generation', 'finalizing'],
    )
    expect(events.filter((e) => 'platformStep' in e)).toHaveLength(2)
  },
)
