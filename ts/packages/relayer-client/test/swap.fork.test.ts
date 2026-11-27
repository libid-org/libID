/// The Base routes against the real Uniswap contracts, on an anvil fork of
/// `BASE_RPC_URL`: the quoter's price, then the batch's swap calls sent by a
/// holder of the token sell exactly the allowance for at least the ETH asked for.
/// Skips without `BASE_RPC_URL`.

import { type ChildProcess, spawn } from 'node:child_process'
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
} from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { base } from 'viem/chains'
import { afterAll, expect, test } from 'vitest'

import { quoteSwap, SWAP_ROUTES, swapCalls, withSlippage } from '../src/index.js'

const RPC = process.env.BASE_RPC_URL
const FORK = 'http://127.0.0.1:8547'
// UniswapV3Factory on Base, from the same deployments page as the router.
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'

let anvil: ChildProcess | undefined
afterAll(() => anvil?.kill())

test.skipIf(!RPC)(
  'each Base route sells its allowance for at least the ETH asked for',
  async () => {
    anvil = spawn('anvil', ['--fork-url', RPC as string, '--port', '8547', '--silent'])
    const transport = http(FORK, { retryCount: 30, retryDelay: 500 })
    const client = createPublicClient({ transport })
    await client.getBlockNumber()
    const test = createTestClient({ chain: base, mode: 'anvil', transport })
    const now = Number((await client.getBlock()).timestamp)

    for (const route of SWAP_ROUTES[base.id]) {
      // The token's 0.3% pool with WETH holds the token; the route's fee tier differs.
      const holder = await client.readContract({
        address: FACTORY,
        abi: parseAbi(['function getPool(address, address, uint24) view returns (address)']),
        functionName: 'getPool',
        args: [route.token, route.weth, 3000],
      })
      expect(route.fee).not.toBe(3000)
      await test.impersonateAccount({ address: holder })
      await test.setBalance({ address: holder, value: parseEther('1') })
      const sender = createWalletClient({ account: holder, chain: base, transport })
      const token = { address: route.token, abi: erc20Abi, functionName: 'balanceOf' } as const
      const before = await client.readContract({ ...token, args: [holder] })

      const minOut = parseEther('0.001')
      const amountIn = withSlippage(await quoteSwap(client, route, { out: minOut }), 100)
      const recipient: Address = privateKeyToAddress(generatePrivateKey())
      for (const call of swapCalls({ route, amountIn, minOut }, recipient, now + 600)) {
        const hash = await sender.sendTransaction({ to: call.to, data: call.data })
        expect((await client.waitForTransactionReceipt({ hash })).status).toBe('success')
      }
      expect(await client.getBalance({ address: recipient })).toBeGreaterThanOrEqual(minOut)
      expect(before - (await client.readContract({ ...token, args: [holder] }))).toBe(amountIn)
      const allowance = {
        ...token,
        functionName: 'allowance',
        args: [holder, route.router],
      } as const
      expect(await client.readContract(allowance)).toBe(0n)
    }
  },
  120_000,
)
