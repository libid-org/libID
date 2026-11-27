import { afterEach, expect, test, vi } from 'vitest'

import { indexerHoldings, shortfall, withSlippage } from './swap.js'

const NODE = `0x${'ab'.repeat(32)}` as const
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/// One amount as `GET /v1/escrow/node/{node}` serves it.
const amount = (chainId: number, token: string, units: string) => ({
  chainId,
  handle: { platform: 'x', platformId: null, handleNode: NODE, handle: null },
  holder: null,
  token,
  amount: units,
  round: '0',
  symbol: 'USDC',
  decimals: 6,
  value: '1.5',
  usd: '1.50',
})

afterEach(() => vi.unstubAllGlobals())

test('reads every page of the indexer, for the chain asked', async () => {
  const asked: URL[] = []
  vi.stubGlobal('fetch', async (url: URL) => {
    asked.push(url)
    const page = url.searchParams.get('before')
      ? { amounts: [amount(8453, USDC.toLowerCase(), '1500000')], next: null }
      : {
          pricedAt: 1,
          amounts: [
            amount(8453, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', '2'),
            amount(1, USDC, '9'),
          ],
          next: 'cursor',
        }
    return Response.json({ handle: {}, ...page })
  })
  const held = await indexerHoldings('https://indexer.test')(NODE, 8453)
  expect(held).toEqual([
    { token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', amount: 2n },
    { token: USDC, amount: 1_500_000n },
  ])
  expect(asked.map((u) => `${u.pathname}?${u.searchParams}`)).toEqual([
    `/v1/escrow/node/${NODE}?chain=8453&limit=100`,
    `/v1/escrow/node/${NODE}?chain=8453&limit=100&before=cursor`,
  ])
})

test('an indexer error names its code', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ error: { code: 'not_synced', message: 'no window yet' } }, { status: 503 }),
  )
  await expect(indexerHoldings('https://indexer.test')(NODE, 8453)).rejects.toThrow(
    'indexer 503 not_synced: no window yet',
  )
})

test('the shortfall and the slippage bound', () => {
  expect(shortfall(10n, 4n)).toBe(6n)
  expect(shortfall(4n, 10n)).toBe(0n)
  expect(withSlippage(1_800_001n, 100)).toBe(1_818_002n)
  expect(withSlippage(100n, 100)).toBe(101n)
})
