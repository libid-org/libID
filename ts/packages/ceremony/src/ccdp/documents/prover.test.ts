import { afterEach, expect, it, vi } from 'vitest'
import { LedgerId } from '@libid/ledger'
import { startProver } from './prover.js'
import type { ProverContext } from '../../prover/context.js'
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
vi.mock('virtual:ceremony-assets', () => ({
  notaryAddresses: ['https://notary.lib.id', 'https://testnet.notary.lib.id'],
}))
vi.mock('../../prefetch/registration.js', () => ({ claimRootWorker: vi.fn() }))
vi.mock('../../platforms/google/1/prover.js', () => ({ prove }))
vi.mock('../../ui.js', () => ({
  view: vi.fn(),
  progressView: () => ({ stop: vi.fn(), update: vi.fn() }),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it.each(['test:mainnet', 'test:testnet', 'test:MAINNET', 'unknown:1'])(
  'decodes %s before passing OAuth return to the platform [LIBID-OAUTH-021]',
  async (encoded) => {
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
      platformId: 'google',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: 'https://bridge.test/callback',
      codeVerifier: null,
      ledgerId: encoded,
    })
    if (encoded === 'test:mainnet' || encoded === 'test:testnet') {
      await vi.waitFor(() => expect(prove).toHaveBeenCalledOnce())
      const context = prove.mock.calls[0][0]
      expect(context.ledgerId.encode()).toBe(encoded)
      expect(context.ledgerId.hash()).toEqual(LedgerId.decode(encoded).hash())
      expect(context.notaryAddress).toBe(
        encoded === 'test:testnet' ? 'https://testnet.notary.lib.id' : 'https://notary.lib.id',
      )
      expect(context.oauthReturn.fragment).toBe('#error=access_denied')
    } else {
      expect(connection.send).toHaveBeenCalledWith({
        type: 'abort-ceremony',
        reason: 'Proving failed',
      })
      expect(prove).not.toHaveBeenCalled()
    }
  },
)
