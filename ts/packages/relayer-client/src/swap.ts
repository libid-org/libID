/// What a handle's escrow holds, and how an approved token pays the part of the
/// refund its claimed ETH does not: Uniswap v3's SwapRouter02 sells a signed
/// token amount, the whole allowance, for at least that much WETH and unwraps
/// all of it to the wallet.

import { type Call, handleEscrowAbi } from '@libid/contracts'
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  type PublicClient,
  parseAbi,
} from 'viem'

/// An approved token and the Uniswap v3 pool its swaps to ETH go through.
export type SwapRoute = {
  token: Address
  /// The pool's fee tier, in hundredths of a basis point.
  fee: number
  router: Address
  quoter: Address
  weth: Address
}

// Uniswap v3 on Base: SwapRouter02, QuoterV2, WETH (see the README).
const BASE_UNISWAP = {
  router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  weth: '0x4200000000000000000000000000000000000006',
} as const

/// Approved tokens by chain id (sources in the README).
export const SWAP_ROUTES: Record<number, readonly SwapRoute[]> = {
  8453: [
    // USDC, issued by Circle.
    { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', fee: 500, ...BASE_UNISWAP },
    // USDT bridged from Ethereum by the Base standard bridge, not issued by Tether.
    { token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', fee: 500, ...BASE_UNISWAP },
  ],
}

// IV3SwapRouter, IMulticallExtended and IPeripheryPaymentsWithFeeExtended of
// Uniswap/swap-router-contracts; IQuoterV2 of Uniswap/v3-periphery.
export const swapAbi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

/// SwapRouter02's `Constants.ADDRESS_THIS`: the router keeps the WETH to unwrap.
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'

export type Holding = { token: Address; amount: bigint }

/// What a handle node holds in the escrow on a chain.
export type Holdings = (handleNode: Hex, chainId: number) => Promise<Holding[]>

/// `HandleEscrow.escrowed` of each of `tokens`, read from the chain.
export function escrowHoldings(
  client: PublicClient,
  escrow: Address,
  tokens: readonly Address[],
): Holdings {
  return (handleNode) =>
    Promise.all(
      tokens.map(async (token) => ({
        token,
        amount: await client.readContract({
          address: escrow,
          abi: handleEscrowAbi,
          functionName: 'escrowed',
          args: [handleNode, token],
        }),
      })),
    )
}

/// The usernames-indexer's `GET /v1/escrow/node/{node}?chain=`, every page.
/// It lags the chain, missing deposits it has not indexed.
export function indexerHoldings(indexerUrl: string): Holdings {
  return async (handleNode, chainId) => {
    const held: Holding[] = []
    for (let before: string | undefined, first = true; first || before; first = false) {
      const url = new URL(`/v1/escrow/node/${handleNode}`, indexerUrl)
      url.search = new URLSearchParams({
        chain: `${chainId}`,
        limit: '100',
        ...(before && { before }),
      }).toString()
      const response = await fetch(url)
      const body = await response.json()
      if (!response.ok) {
        throw new Error(`indexer ${response.status} ${body.error?.code}: ${body.error?.message}`)
      }
      held.push(...parseHoldings(body, chainId))
      before = body.next ?? undefined
    }
    return held
  }
}

/// The `amounts` of an indexer escrow answer on `chainId`.
export function parseHoldings(
  body: { amounts: { chainId: number; token: string; amount: string }[] },
  chainId: number,
): Holding[] {
  return body.amounts
    .filter((a) => a.chainId === chainId)
    .map((a) => ({ token: getAddress(a.token), amount: BigInt(a.amount) }))
}

/// The claim cannot repay the relayer: `held` and `required` in wei.
export class ClaimTooSmall extends Error {
  override readonly name = 'ClaimTooSmall'
  constructor(
    readonly held: bigint,
    readonly required: bigint,
  ) {
    super(`the claim is worth ${held} wei, the refund needs ${required}`)
  }
}

/// The ETH the refund needs beyond `eth`.
export const shortfall = (refund: bigint, eth: bigint) => (refund > eth ? refund - eth : 0n)

/// `amount` plus `bps` basis points, rounded up.
export const withSlippage = (amount: bigint, bps: number) =>
  (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n

/// The quoter's answer: wei for `amountIn` tokens, or tokens for `amountOut` wei.
export async function quoteSwap(
  client: PublicClient,
  r: SwapRoute,
  amount: { in: bigint } | { out: bigint },
): Promise<bigint> {
  const pair = { tokenIn: r.token, tokenOut: r.weth, fee: r.fee, sqrtPriceLimitX96: 0n }
  const call =
    'in' in amount
      ? { functionName: 'quoteExactInputSingle', args: [{ ...pair, amountIn: amount.in }] }
      : { functionName: 'quoteExactOutputSingle', args: [{ ...pair, amount: amount.out }] }
  const quoted = await client.simulateContract({
    address: r.quoter,
    abi: swapAbi,
    ...call,
  } as never)
  return (quoted as { result: readonly bigint[] }).result[0]
}

/// A swap of `amountIn` of `route`'s token for at least `minOut` wei.
export type SwapPlan = { route: SwapRoute; amountIn: bigint; minOut: bigint }

/// Approve the router for exactly `amountIn`, which the swap spends whole, then
/// sell it for at least `minOut` wei and unwrap all it bought to `wallet`,
/// before `deadline`.
export function swapCalls(
  { route: r, amountIn, minOut }: SwapPlan,
  wallet: Address,
  deadline: number,
): Call[] {
  const buy = encodeFunctionData({
    abi: swapAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: r.token,
        tokenOut: r.weth,
        fee: r.fee,
        recipient: ADDRESS_THIS,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const unwrap = encodeFunctionData({
    abi: swapAbi,
    functionName: 'unwrapWETH9',
    args: [minOut, wallet],
  })
  const approve = { abi: erc20Abi, functionName: 'approve', args: [r.router, amountIn] } as const
  const multicall = [BigInt(deadline), [buy, unwrap]] as const
  return [
    { to: r.token, data: encodeFunctionData(approve) },
    {
      to: r.router,
      data: encodeFunctionData({ abi: swapAbi, functionName: 'multicall', args: multicall }),
    },
  ]
}
