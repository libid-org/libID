import { LedgerId } from '@libid/ledger'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveNotaryAddress } from '../notary.js'
import { prepareNotarization } from './session.js'

vi.mock('virtual:ceremony-assets', () => ({
  notaryAddresses: ['https://notary.lib.id', 'https://testnet.notary.lib.id'],
}))
vi.mock('../../assets.js', async (original) => ({
  ...(await original<typeof import('../../assets.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))
afterEach(() => vi.unstubAllGlobals())
it.each(['test:mainnet', 'test:testnet'])(
  'starts the selected notary only, without retrying another network: %s [LIBID-PROVER-008]',
  async (encoded) => {
    const notaryAddress = resolveNotaryAddress(LedgerId.decode(encoded))
    expect(notaryAddress).toBe(
      encoded === 'test:testnet' ? 'https://testnet.notary.lib.id' : 'https://notary.lib.id',
    )
    const messages: unknown[] = [],
      terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage?: (event: { data: unknown }) => void
        terminate = terminate
        postMessage(message: unknown) {
          messages.push(message)
          queueMicrotask(() => this.onmessage?.({ data: { type: 'error' } }))
        }
      },
    )
    await expect(
      prepareNotarization(
        'https://api.x.com/2/users/me',
        notaryAddress,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Notarization failed')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'prepare',
      notaryAddress,
    })
    expect(terminate).toHaveBeenCalledOnce()
  },
)

it('rejects invalid notary addresses before creating a worker', async () => {
  const worker = vi.fn()
  vi.stubGlobal('Worker', worker)
  for (const address of ['http://notary.test', 'https://notary.test/', 'https://notary.test/path'])
    await expect(
      prepareNotarization('https://api.x.com/2/users/me', address, new AbortController().signal),
    ).rejects.toThrow()
  expect(worker).not.toHaveBeenCalled()
})
