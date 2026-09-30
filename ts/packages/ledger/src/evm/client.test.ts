import { EventEmitter } from 'node:events'
import {
  createPublicClient,
  custom,
  defineChain,
  type EIP1193Provider,
  HttpRequestError,
  http,
  toHex,
} from 'viem'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { connect, type Families, type Query } from '../client.js'
import { defineLedger, type Ledgers } from '../index.js'
import { readMethods, walletReads } from './client.js'

type Request = { method: string; params?: unknown }

const chainId = 424242
const rpc = 'https://rpc.example/'
const account = '0x1111111111111111111111111111111111111111'
const block = { method: 'eth_blockNumber' }
const call = { method: 'eth_call', params: [{ to: account, data: '0x1234' }, 'latest'] }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(namespaces?: Record<string, { accounts: string[]; methods: string[] }>) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    const { id } = JSON.parse(String(init?.body))
    return Response.json({ jsonrpc: '2.0', id, result: '0xa' })
  })
  const events = new EventEmitter()
  let chain = chainId
  let answer: (request: Request) => Promise<unknown> = async () => '0xb'
  const request = vi.fn(async (args: Request) =>
    args.method === 'eth_chainId' ? toHex(chain) : answer(args),
  )
  const provider = Object.assign(events, { request }, namespaces ? { session: { namespaces } } : {})
  const fallback = http(rpc, { timeout: 15_000, retryCount: 1 })({})
  let reads = walletReads(provider, chainId, fallback)
  return {
    get reads() {
      return reads
    },
    /** A new session for the same wallet, with fresh remembered state. */
    reconnect() {
      reads.close()
      reads = walletReads(provider, chainId, fallback)
    },
    provider,
    fetch,
    request,
    answer(fn: typeof answer) {
      answer = fn
    },
    chain(id: number) {
      chain = id
      events.emit('chainChanged', toHex(id))
    },
  }
}

it('prefers the wallet, remembers missing methods, keeps refusals visible and never sends writes', async () => {
  const s = setup()
  expect(await s.reads.request(block)).toBe('0xb')
  expect(s.fetch).not.toHaveBeenCalled()
  for (const code of [4200, -32601, -32004]) {
    s.reconnect()
    s.answer(async () => {
      throw Object.assign(new Error('Unsupported'), { code })
    })
    expect(await s.reads.request(call)).toBe('0xa')
    const count = s.request.mock.calls.length
    expect(await s.reads.request(call)).toBe('0xa')
    expect(s.request.mock.calls.length, 'Unsupported reads go straight to fallback').toBe(count)
    s.answer(async () => '0xb')
    expect(await s.reads.request(block), 'Other wallet reads remain available').toBe('0xb')
  }
  for (const code of [3, -32000, -32602, -32603, 4001, 4100]) {
    s.reconnect()
    s.answer(async () => {
      throw Object.assign(new Error('Stop this request'), { code })
    })
    const count = s.fetch.mock.calls.length
    await expect(s.reads.request(call)).rejects.toThrow(/Stop this request/)
    expect(s.fetch.mock.calls.length).toBe(count)
  }
  const before = [s.fetch.mock.calls.length, s.request.mock.calls.length]
  await expect(
    s.reads.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account }] }),
  ).rejects.toThrow(/not a read method/)
  expect([s.fetch.mock.calls.length, s.request.mock.calls.length], 'No writes').toEqual(before)
  s.reads.close()
  expect(await s.reads.request(block), 'Reads can outlive the session').toBe('0xa')
  expect(s.provider.listenerCount('chainChanged')).toBe(0)
})

it('discards a read that crosses a chain change or the session closing', async () => {
  const s = setup()
  s.chain(1)
  expect(await s.reads.request(block)).toBe('0xa')
  s.chain(chainId)
  for (const change of [
    () => {
      s.chain(1)
      s.chain(chainId)
    },
    () => s.reads.close(),
  ]) {
    s.reconnect()
    let finish!: (value: string) => void
    s.answer(() => new Promise<string>((resolve) => (finish = resolve)))
    const pending = s.reads.request(block)
    await tick()
    change()
    finish('0xdead')
    expect(await pending, 'Never use data from a stale wallet context').toBe('0xa')
  }
})

it('uses only WalletConnect read methods approved for this chain', async () => {
  const chain = `eip155:${chainId}`
  const s = setup({ eip155: { accounts: [`${chain}:${account}`], methods: ['eth_call'] } })
  s.request.mockImplementation(async (args) => (args.method === 'eth_chainId' ? chainId : '0xb'))
  expect(await s.reads.request({ method: 'eth_chainId' })).toBe(toHex(chainId))
  expect(await s.reads.request(call)).toBe('0xb')
  expect(await s.reads.request(block)).toBe('0xa')
  expect(s.request.mock.calls.every(([args]) => args.method !== 'eth_blockNumber')).toBe(true)
  s.provider.session!.namespaces = {
    [chain]: { accounts: [`${chain}:${account}`], methods: ['eth_blockNumber'] },
    'eip155:1': { accounts: [`eip155:1:${account}`], methods: ['eth_call'] },
  }
  expect(await s.reads.request(block), 'Chain-specific namespaces are supported').toBe('0xb')
  expect(await s.reads.request(call), 'Approval on another chain is not enough').toBe('0xa')
  for (const code of [3001, 5000, 5002]) {
    s.request.mockImplementation(async (args) => {
      if (args.method === 'eth_chainId') return chainId
      throw Object.assign(new Error('WalletConnect refused'), { code })
    })
    const count = s.fetch.mock.calls.length
    await expect(s.reads.request(block)).rejects.toThrow(/WalletConnect refused/)
    expect(s.fetch.mock.calls.length, 'Preserve WalletConnect permission errors').toBe(count)
  }
  s.request.mockImplementation(async (args) => {
    if (args.method === 'eth_chainId') return chainId
    throw Object.assign(new Error('Unsupported methods'), { code: 5101 })
  })
  expect(await s.reads.request(block), "Handle WalletConnect's unsupported code").toBe('0xa')
  const count = s.request.mock.calls.length
  expect(await s.reads.request(block)).toBe('0xa')
  expect(s.request.mock.calls.length).toBe(count)
  s.reconnect()
  s.provider.session!.namespaces = {}
  expect(await s.reads.request(block), 'Expired sessions cannot route reads').toBe('0xa')
  expect(readMethods.every((method) => !/send|sign|requestAccounts/.test(method))).toBe(true)
})

it('falls back from WalletConnect backend failures, cools down and recovers without masking refusals', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  const s = setup({
    eip155: {
      accounts: [`eip155:${chainId}:${account}`],
      methods: ['eth_call', 'eth_blockNumber'],
    },
  })
  const internal = (originalError: unknown) => ({
    code: -32603,
    message: 'Internal JSON-RPC error',
    data: { originalError },
  })
  const offline = new TypeError('Failed to fetch')
  const unavailable = [
    offline,
    new HttpRequestError({ url: rpc, status: 503 }),
    internal({ error: { statusCode: 502, message: 'Bad gateway' } }),
    internal(new Error('Request failed', { cause: { code: 'ECONNRESET' } })),
    internal({ code: -32603, message: 'Network request failed' }),
    new DOMException('A network error occurred', 'NetworkError'),
    new DOMException('The request timed out', 'TimeoutError'),
    { name: 'SocketClosedError' },
    { status: 429 },
    { code: -32002, message: 'Resource unavailable' },
  ]
  for (const error of unavailable) {
    s.reconnect()
    s.answer(async () => {
      throw error
    })
    expect(await s.reads.request(call)).toBe('0xa')
    const count = s.request.mock.calls.length
    expect(await s.reads.request(block)).toBe('0xa')
    expect(s.request.mock.calls.length, 'Cooldown also covers other reads').toBe(count)
    s.answer(async () => '0xb')
    vi.advanceTimersByTime(30_000)
    expect(await s.reads.request(call), 'Retry the wallet after its cooldown').toBe('0xb')
  }
  const refusals = [
    ...[3, -32000, -32602, 3001, 4001, 4100, 5000, 5002].map((code) => ({ code, cause: offline })),
    { status: 503, data: { error: { code: 3, data: '0xdeadbeef' } } },
    { status: 503, data: '0x' },
    { status: 503, message: 'execution reverted: unavailable' },
    { status: 403, cause: offline },
    { name: 'AbortError', cause: offline },
    { message: 'User rejected request', cause: offline },
    { code: 'CALL_EXCEPTION', cause: offline },
    { code: -32603, message: 'Internal error' },
    new TypeError('Cannot read properties of undefined'),
  ]
  for (const error of refusals) {
    s.reconnect()
    s.answer(async () => {
      throw internal(error)
    })
    const count = s.fetch.mock.calls.length
    await expect(s.reads.request(call)).rejects.toBeDefined()
    expect(s.fetch.mock.calls.length, 'Nested refusals and unknown errors stay visible').toBe(count)
  }
  const cyclic: Record<string, unknown> = { status: 503 }
  cyclic.cause = cyclic
  s.reconnect()
  s.answer(async () => {
    throw cyclic
  })
  expect(await s.reads.request(call), 'Cyclic wrappers cannot hang the read').toBe('0xa')
  s.answer(async () => '0xb')
  s.provider.emit('connect', { chainId: toHex(chainId) })
  expect(await s.reads.request(call), 'Reconnection clears the cooldown').toBe('0xb')

  s.fetch.mockImplementation(async (_, init) => {
    const { id } = JSON.parse(String(init?.body))
    return Response.json({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } })
  })
  s.answer(async () => {
    throw offline
  })
  await expect(s.reads.request(call), 'RPC failure must also surface').rejects.toThrow(
    /execution reverted/,
  )
})

it('derives a missing wallet priority fee without an HTTP request', async () => {
  const chain = defineChain({
    id: chainId,
    name: 'Test',
    nativeCurrency: { name: 'TIA', symbol: 'TIA', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  })
  let supportsPriority = false
  const injected = setup()
  injected.answer(async ({ method }) => {
    if (method === 'eth_getBlockByNumber') {
      return { number: '0x1', baseFeePerGas: '0x64', transactions: [] }
    }
    if (method === 'eth_gasPrice') return '0x6e'
    expect(method).toBe('eth_maxPriorityFeePerGas')
    if (supportsPriority) return '0x7'
    throw Object.assign(new Error('Method not found'), { code: -32601 })
  })
  const walletConnect = walletReads(
    Object.assign(new EventEmitter(), {
      request: injected.request,
      session: {
        namespaces: {
          eip155: {
            accounts: [`eip155:${chainId}:${account}`],
            methods: ['eth_getBlockByNumber', 'eth_gasPrice'],
          },
        },
      },
    }),
    chainId,
    http(rpc)({}),
  )
  for (const reads of [injected.reads, walletConnect]) {
    const client = createPublicClient({ chain, transport: custom(reads) })
    for (let i = 0; i < 2; i++) {
      expect(await client.estimateFeesPerGas()).toEqual({
        maxPriorityFeePerGas: 10n,
        maxFeePerGas: 130n,
      })
    }
  }
  expect(injected.fetch).not.toHaveBeenCalled()
  expect(
    injected.request.mock.calls.filter(([args]) => args.method === 'eth_maxPriorityFeePerGas'),
    'Remember unsupported injected methods and skip unapproved WalletConnect methods',
  ).toHaveLength(1)
  supportsPriority = true
  injected.reconnect()
  const client = createPublicClient({ chain, transport: custom(injected.reads) })
  expect((await client.estimateFeesPerGas()).maxPriorityFeePerGas).toBe(7n)
  expect(injected.fetch, "Still use a wallet's priority estimate").not.toHaveBeenCalled()
  injected.reads.close()
  expect(await injected.reads.request({ method: 'eth_maxPriorityFeePerGas' })).toBe('0xa')
  expect(injected.fetch, 'Keep HTTP reads available without a wallet').toHaveBeenCalledOnce()
})

it('falls back from an unresponsive wallet with a cooldown and recovers', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  const s = setup()
  s.answer(() => new Promise(() => {}))
  const pending = s.reads.request(block)
  await tick()
  vi.advanceTimersByTime(5_000)
  expect(await pending).toBe('0xa')
  const count = s.request.mock.calls.length
  expect(await s.reads.request(block)).toBe('0xa')
  expect(s.request.mock.calls.length, 'Avoid repeated waits while the wallet sleeps').toBe(count)
  vi.advanceTimersByTime(30_000)
  s.answer(async () => '0xb')
  expect(await s.reads.request(block)).toBe('0xb')
  s.answer(async () => {
    throw Object.assign(new Error('Disconnected'), { code: 4900 })
  })
  expect(await s.reads.request(block)).toBe('0xa')
  s.answer(async () => '0xb')
  s.provider.emit('connect', { chainId: toHex(chainId) })
  expect(await s.reads.request(block), 'A reconnect clears the cooldown').toBe('0xb')
})

// EVM behavior beyond the shared contract in ../client.test.ts.
describe('EVM client', () => {
  type Handlers = Record<string, (params: unknown[]) => unknown>
  const registry = `0x${'2'.repeat(40)}` as const
  const ledger = defineLedger({
    chain: `eip155:${chainId}`,
    name: 'Test',
    testnet: true,
    currency: { symbol: 'TIA', decimals: 18 },
    notary: 'http://localhost:4687',
    addresses: { identityNames: registry },
  })
  const feeBlock = { number: '0x1', baseFeePerGas: '0x64', transactions: [] }
  const tx = { to: registry, data: '0x1234' as const, value: 5n }
  const client = (explorer?: string) => connect({ ledgers: [{ ledger, rpc, explorer }] })

  /** A JSON-RPC endpoint answering from `handlers`; unknown methods are "not found". */
  function endpoint(handlers: Handlers) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const { id, method, params } = JSON.parse(String(init?.body))
      const handler = handlers[method]
      return Response.json(
        handler
          ? { jsonrpc: '2.0', id, result: handler(params ?? []) }
          : { jsonrpc: '2.0', id, error: { code: -32601, message: `No ${method}` } },
      )
    })
  }

  function scriptedWallet(overrides: Handlers = {}) {
    let chain = chainId
    const handlers: Handlers = {
      eth_accounts: () => [account],
      eth_requestAccounts: () => [account],
      eth_chainId: () => toHex(chain),
      eth_call: () => '0x',
      eth_estimateGas: () => '0x5208',
      eth_getBlockByNumber: () => feeBlock,
      eth_maxPriorityFeePerGas: () => '0x1',
      eth_getTransactionCount: () => '0x0',
      eth_sendTransaction: () => `0x${'a'.repeat(64)}`,
      ...overrides,
    }
    const request = vi.fn(async ({ method, params }: Request) => {
      const handler = handlers[method]
      if (!handler) throw Object.assign(new Error(`No ${method}`), { code: 4200 })
      return handler((params ?? []) as unknown[])
    })
    return Object.assign(new EventEmitter(), {
      request,
      setChain(id: number) {
        chain = id
      },
    })
  }

  it("reads through a configured RPC instead of the ledger's public one", async () => {
    const urls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      urls.push(String(input))
      const { id } = JSON.parse(String(init?.body))
      return Response.json({ jsonrpc: '2.0', id, result: '0x10' })
    })
    const listed = defineLedger({
      chain: `eip155:${chainId}`,
      name: 'Test',
      testnet: true,
      currency: { symbol: 'TIA', decimals: 18 },
      notary: 'http://localhost:4687',
      addresses: {},
      rpc: 'https://public-rpc.example/',
    })
    const block: Query<[], bigint> = { evm: async (read) => read.block }
    await connect({ ledgers: [{ ledger: listed, rpc: 'https://mine.example/' }] }).read(
      listed,
      block,
      [],
    )
    await connect({ ledgers: [{ ledger: listed }] }).read(listed, block, [])
    expect(urls).toEqual(['https://mine.example/', 'https://public-rpc.example/'])
  })

  it('returns named deployments checksummed and rejects unknown names', async () => {
    endpoint({ eth_blockNumber: () => '0x10' })
    const named = (name: string): Query<[], string> => ({
      evm: async (read) => read.address(name),
    })
    expect(await client().read(ledger, named('identityNames'), [])).toBe(
      '0x2222222222222222222222222222222222222222',
    )
    await expect(client().read(ledger, named('verifier'), [])).rejects.toThrow(
      /no verifier address/,
    )
  })

  it('estimates the network fee with EIP-1559 fees, or legacy gas prices when unsupported', async () => {
    const handlers: Handlers = {
      eth_estimateGas: () => '0x5208',
      eth_getBlockByNumber: () => feeBlock,
      eth_maxPriorityFeePerGas: () => '0x7',
      eth_gasPrice: () => '0x6e',
    }
    const from = client().parseAccount(ledger, account)
    endpoint(handlers)
    // maxFeePerGas = baseFee 100 × 1.2 + tip 7
    expect(await client().estimate(ledger, tx, from)).toBe(21_000n * 127n)
    vi.restoreAllMocks()
    endpoint({
      ...handlers,
      eth_getBlockByNumber: () => ({ ...feeBlock, baseFeePerGas: undefined }),
    })
    // gasPrice 110 × 1.2
    expect(await client().estimate(ledger, tx, from)).toBe(21_000n * 132n)
  })

  it('switches to the chain, adding it when the wallet does not know it', async () => {
    endpoint({})
    const added: unknown[] = []
    let known = false
    const wallet = scriptedWallet({
      wallet_switchEthereumChain: () => {
        if (!known) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 })
        wallet.setChain(chainId)
        return null
      },
      wallet_addEthereumChain: (params) => {
        added.push(...params)
        known = true
        return null
      },
    })
    wallet.setChain(1)
    expect((await client('https://explorer.example').connect(ledger, wallet)).account).toBe(account)
    expect(added).toEqual([
      {
        chainId: toHex(chainId),
        chainName: 'Test',
        nativeCurrency: { name: 'TIA', symbol: 'TIA', decimals: 18 },
        rpcUrls: [rpc],
        blockExplorerUrls: ['https://explorer.example'],
      },
    ])
    const offered: unknown[] = []
    const fresh = scriptedWallet({
      wallet_switchEthereumChain: () => {
        if (!offered.length) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 })
        fresh.setChain(chainId)
        return null
      },
      wallet_addEthereumChain: (params) => offered.push(...params),
    })
    fresh.setChain(1)
    const listed = defineLedger({
      chain: `eip155:${chainId}`,
      name: 'Test',
      testnet: true,
      currency: { symbol: 'TIA', decimals: 18 },
      notary: 'http://localhost:4687',
      addresses: { identityNames: registry },
      rpc: 'https://public-rpc.example/',
      explorer: 'https://public-explorer.example',
    })
    await connect({ ledgers: [{ ledger: listed }] }).connect(listed, fresh)
    expect(offered, "Without overrides, wallets get the ledger's public endpoints").toMatchObject([
      {
        rpcUrls: ['https://public-rpc.example/'],
        blockExplorerUrls: ['https://public-explorer.example'],
      },
    ])
    const declining = scriptedWallet({
      wallet_switchEthereumChain: () => {
        throw Object.assign(new Error('User rejected'), { code: 4001 })
      },
    })
    declining.setChain(1)
    await expect(client().connect(ledger, declining)).rejects.toMatchObject({ code: 'rejected' })
  })

  it('simulates the exact transaction from the account before sending', async () => {
    endpoint({})
    const wallet = scriptedWallet()
    await (await client().connect(ledger, wallet)).send(tx)
    const methods = wallet.request.mock.calls.map(([{ method }]) => method)
    expect(methods.indexOf('eth_call')).toBeLessThan(methods.indexOf('eth_sendTransaction'))
    expect(wallet.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'eth_call',
        params: [expect.objectContaining({ from: account, to: registry, value: '0x5' }), 'latest'],
      }),
    )
  })

  it('accepts viem providers and derives the family from the chain', () => {
    expectTypeOf<EIP1193Provider>().toMatchTypeOf<Families['evm']['wallet']>()
    expectTypeOf<(typeof Ledgers)['EdenTestnet']['family']>().toEqualTypeOf<'evm'>()
  })
})
