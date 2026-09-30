import { EventEmitter } from 'node:events'
import { toHex } from 'viem'
import { vi } from 'vitest'
import { connect } from '../client.js'
import type { Harness } from '../conformance.harness.js'
import { defineLedger } from '../index.js'

type Node = (method: string, params: unknown[]) => unknown

const raw = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'
const canonical = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const target = `0x${'2'.repeat(40)}` as const
const reverts = `0x${'3'.repeat(40)}` as const

// Each fake gets its own RPC URL, so fakes in one test never answer for each other.
const nodes = new Map<string, Node>()
async function serve(input: string | URL | Request, init?: RequestInit) {
  const node = nodes.get(String(input))
  if (!node) throw new TypeError(`No fake node at ${input}`)
  const { id, method, params } = JSON.parse(String(init?.body))
  try {
    return Response.json({ jsonrpc: '2.0', id, result: node(method, params ?? []) })
  } catch (error) {
    const { code, message, data } = error as { code: number; message: string; data?: unknown }
    return Response.json({ jsonrpc: '2.0', id, error: { code, message, data } })
  }
}

const declined = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })

export const evm: Harness<'evm'> = {
  setup() {
    const chainId = 1_000_000 + nodes.size
    const rpc = `https://rpc-${nodes.size}.example/`
    const ledger = defineLedger({
      chain: `eip155:${chainId}`,
      name: `Harness ${chainId}`,
      testnet: true,
      currency: { symbol: 'ETH', decimals: 18 },
      notary: 'http://localhost:4687',
      addresses: { target },
      explorer: `https://explorer-${nodes.size}.example`,
    })
    const state = {
      head: 16,
      walletChain: chainId,
      shared: [raw] as string[],
      choice: null as string | null,
      decline: new Set<string>(),
      lose: false,
      prompts: 0,
      sent: 0,
      walletReads: 0,
    }
    // One fake node answers both the RPC endpoint and the wallet's own reads.
    const node: Node = (method, params) => {
      switch (method) {
        case 'eth_chainId':
          return toHex(chainId)
        case 'eth_blockNumber':
          return toHex(state.head)
        case 'eth_getBalance': {
          // An account's balance is the number of the block it was read at.
          const [, tag] = params
          return typeof tag === 'string' && tag.startsWith('0x') ? tag : toHex(state.head)
        }
        case 'eth_call':
          if ((params[0] as { to?: string }).to === reverts) {
            throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x' })
          }
          return '0x'
        case 'eth_estimateGas':
          return '0x5208'
        case 'eth_getBlockByNumber':
          return { number: toHex(state.head), baseFeePerGas: '0x64', transactions: [] }
        case 'eth_maxPriorityFeePerGas':
        case 'eth_gasPrice':
          return '0x1'
        case 'eth_getTransactionCount':
          return '0x0'
        default:
          throw Object.assign(new Error(`No ${method}`), { code: -32601 })
      }
    }
    nodes.set(rpc, node)
    if (!vi.isMockFunction(globalThis.fetch))
      vi.spyOn(globalThis, 'fetch').mockImplementation(serve)

    const wallet = Object.assign(new EventEmitter(), {
      async request({ method, params }: { method: string; params?: unknown }) {
        switch (method) {
          case 'eth_accounts':
            return state.shared
          case 'eth_requestAccounts':
            state.prompts++
            if (state.decline.delete('accounts')) throw declined()
            return state.shared
          case 'eth_chainId':
            return toHex(state.walletChain)
          case 'wallet_switchEthereumChain':
            state.prompts++
            if (state.decline.delete('switch')) throw declined()
            state.walletChain = chainId
            wallet.emit('chainChanged', toHex(chainId))
            return null
          case 'wallet_requestPermissions':
            state.prompts++
            if (state.decline.delete('accounts')) throw declined()
            if (state.choice) state.shared = [state.choice]
            wallet.emit('accountsChanged', state.shared)
            return [{ parentCapability: 'eth_accounts' }]
          case 'eth_sendTransaction':
            state.prompts++
            if (state.decline.delete('send')) throw declined()
            if (state.lose) throw new Error('The connection to the wallet was lost.')
            state.sent++
            return `0x${'a'.repeat(64)}`
          default:
            state.walletReads++
            return node(method, (params ?? []) as unknown[])
        }
      },
    })

    const access = { ledger, rpc }
    return {
      ledger,
      access,
      client: connect({ ledgers: [access] }),
      wallet,
      probe: (read) => read.getBalance({ address: canonical }),
      tx: { to: target, data: '0x1234', value: 5n },
      reverting: { to: reverts, data: '0x1234' },
      accounts: { raw, canonical, other: `0x${'1'.repeat(40)}`, invalid: '0x1234' },
      advance() {
        state.head++
      },
      shareAccount(account, { notify = true } = {}) {
        state.shared = account ? [account] : []
        if (notify) wallet.emit('accountsChanged', state.shared)
      },
      nextChoice(account) {
        state.choice = account
      },
      leaveChain() {
        state.walletChain = 1
        wallet.emit('chainChanged', toHex(1))
      },
      decline(request) {
        state.decline.add(request)
      },
      loseSend() {
        state.lose = true
      },
      get prompts() {
        return state.prompts
      },
      get sent() {
        return state.sent
      },
      get walletReads() {
        return state.walletReads
      },
    }
  },
}
