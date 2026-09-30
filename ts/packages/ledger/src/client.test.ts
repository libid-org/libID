import { EventEmitter } from 'node:events'
import { type EIP1193Provider, toHex } from 'viem'
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'
import {
  type Command,
  connect,
  LedgerError,
  type NamespaceOf,
  type Namespaces,
  type Query,
} from './client.js'
import { defineLedger, type ledgers } from './index.js'

type Request = { method: string; params?: unknown[] }
type Handlers = Record<string, (params: unknown[]) => unknown>

const chainId = 3735928814
const account = '0x1111111111111111111111111111111111111111'
const registry = `0x${'2'.repeat(40)}` as const
const ledger = defineLedger({
  chain: `eip155:${chainId}`,
  name: 'Test',
  testnet: true,
  currency: { symbol: 'TIA', decimals: 18 },
  notary: 'http://localhost:4687',
  addresses: { identityNames: registry },
})
const block = { number: '0x1', baseFeePerGas: '0x64', transactions: [] }
const tx = { to: registry, data: '0x1234' as const, value: 5n }

afterEach(() => vi.restoreAllMocks())

/** A JSON-RPC endpoint answering from `handlers`; unknown methods are "not found". */
function rpc(handlers: Handlers) {
  const answer = ({ id, method, params }: Request & { id: number }) => {
    const handler = handlers[method]
    if (!handler) return { jsonrpc: '2.0', id, error: { code: -32601, message: `No ${method}` } }
    return { jsonrpc: '2.0', id, result: handler(params ?? []) }
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    const body = JSON.parse(String(init?.body))
    return Response.json(Array.isArray(body) ? body.map(answer) : answer(body))
  })
}

function wallet(overrides: Partial<Record<string, (params: unknown[]) => unknown>> = {}) {
  let chain = chainId
  const handlers: Record<string, (params: unknown[]) => unknown> = {
    eth_accounts: () => [account],
    eth_requestAccounts: () => [account],
    eth_chainId: () => toHex(chain),
    eth_call: () => '0x',
    eth_estimateGas: () => '0x5208',
    eth_getBlockByNumber: () => block,
    eth_maxPriorityFeePerGas: () => '0x1',
    eth_getTransactionCount: () => '0x0',
    eth_sendTransaction: () => `0x${'a'.repeat(64)}`,
    wallet_switchEthereumChain: () => {
      chain = chainId
      return null
    },
    ...overrides,
  }
  const request = vi.fn(async ({ method, params }: Request) => {
    const handler = handlers[method]
    if (!handler) throw Object.assign(new Error(`No ${method}`), { code: 4200 })
    return handler(params ?? [])
  })
  return Object.assign(new EventEmitter(), {
    request,
    setChain(id: number) {
      chain = id
    },
    sent: () => request.mock.calls.filter(([{ method }]) => method === 'eth_sendTransaction'),
  })
}

const client = () => connect(ledger, { rpc: 'https://rpc.example/' })

it('runs a query against one block', async () => {
  const blockTags: unknown[] = []
  const fetch = rpc({
    eth_blockNumber: () => '0x10',
    eth_getBalance: ([, tag]) => {
      blockTags.push(tag)
      return '0x7'
    },
    eth_call: ([, tag]) => {
      blockTags.push(tag)
      return '0x'
    },
  })
  const query: Query<[string], { block: bigint; balance: bigint; registry: string }> = {
    eip155: async (read, raw) => {
      const address = read.parseAccount(raw) as `0x${string}`
      const balance = await read.getBalance({ address })
      await read.call({ to: read.address('identityNames'), data: '0x' })
      return { block: read.block, balance, registry: read.address('identityNames') }
    },
  }
  expect(await client().read(query, [account])).toEqual({
    block: 16n,
    balance: 7n,
    registry: '0x2222222222222222222222222222222222222222',
  })
  expect(blockTags).toEqual(['0x10', '0x10'])
  const methods = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method)
  expect(methods.filter((method) => method === 'eth_blockNumber')).toHaveLength(1)
})

it('stops a query when its signal aborts', async () => {
  rpc({ eth_blockNumber: () => '0x10', eth_getBalance: () => '0x7' })
  const controller = new AbortController()
  const query: Query<[], bigint> = {
    eip155: async (read) => {
      controller.abort()
      return read.getBalance({ address: account })
    },
  }
  await expect(client().read(query, [], { signal: controller.signal })).rejects.toThrow(/abort/i)
  await expect(client().read(query, [], { signal: controller.signal })).rejects.toThrow(/abort/i)
})

it('rejects unknown deployment names and invalid accounts', async () => {
  rpc({ eth_blockNumber: () => '0x10' })
  const query: Query<[], string> = { eip155: async (read) => read.address('verifier') }
  await expect(client().read(query, [])).rejects.toThrow(/no verifier address/)
  expect(() => client().parseAccount('0x1234')).toThrow()
  expect(client().parseAccount(account.toUpperCase().replace('0X', '0x'))).toBe(account)
})

it('builds commands for the ledger', () => {
  const command: Command<[number]> = {
    eip155: (ledger, value) => ({
      to: ledger.addresses.identityNames as `0x${string}`,
      data: toHex(value),
    }),
  }
  expect(client().tx(command, [255])).toEqual({ to: registry, data: '0xff' })
})

it('estimates the network fee with EIP-1559 fees, or legacy gas prices when unsupported', async () => {
  const handlers: Handlers = {
    eth_estimateGas: () => '0x5208',
    eth_getBlockByNumber: () => block,
    eth_maxPriorityFeePerGas: () => '0x7',
    eth_gasPrice: () => '0x6e',
  }
  rpc(handlers)
  // maxFeePerGas = baseFee 100 × 1.2 + tip 7
  expect(await client().estimate(tx, client().parseAccount(account))).toBe(21_000n * 127n)
  rpc({ ...handlers, eth_getBlockByNumber: () => ({ ...block, baseFeePerGas: undefined }) })
  // gasPrice 110 × 1.2
  expect(await client().estimate(tx, client().parseAccount(account))).toBe(21_000n * 132n)
})

it('connects without prompting only to an authorized wallet on this ledger', async () => {
  rpc({})
  await expect(
    client().connect(wallet({ eth_accounts: () => [] }), { prompt: false }),
  ).rejects.toMatchObject({ code: 'no-account' })
  const elsewhere = wallet()
  elsewhere.setChain(1)
  await expect(client().connect(elsewhere, { prompt: false })).rejects.toMatchObject({
    code: 'wrong-chain',
  })
  expect(elsewhere.request).not.toHaveBeenCalledWith(
    expect.objectContaining({ method: 'wallet_switchEthereumChain' }),
  )
  const session = await client().connect(wallet(), { prompt: false })
  expect(session.account).toBe(account)
})

it('asks for accounts and switches or adds the chain when prompting', async () => {
  rpc({})
  const rejected = wallet({
    eth_requestAccounts: () => {
      throw Object.assign(new Error('User rejected'), { code: 4001 })
    },
  })
  await expect(client().connect(rejected)).rejects.toMatchObject({ code: 'rejected' })

  const added: unknown[] = []
  let known = false
  const unknown = wallet({
    wallet_switchEthereumChain: () => {
      if (!known) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 })
      unknown.setChain(chainId)
      return null
    },
    wallet_addEthereumChain: (params) => {
      added.push(...params)
      known = true
      return null
    },
  })
  unknown.setChain(1)
  const session = await connect(ledger, {
    rpc: 'https://rpc.example/',
    explorer: 'https://explorer.example',
  }).connect(unknown)
  expect(session.account).toBe(account)
  expect(added).toEqual([
    {
      chainId: toHex(chainId),
      chainName: 'Test',
      nativeCurrency: { name: 'TIA', symbol: 'TIA', decimals: 18 },
      rpcUrls: ['https://rpc.example/'],
      blockExplorerUrls: ['https://explorer.example'],
    },
  ])

  const declined = wallet({
    wallet_switchEthereumChain: () => {
      throw Object.assign(new Error('User rejected'), { code: 4001 })
    },
  })
  declined.setChain(1)
  await expect(client().connect(declined)).rejects.toMatchObject({ code: 'rejected' })
})

it('sends only after rechecking the wallet and simulating', async () => {
  rpc({})
  const provider = wallet()
  const session = await client().connect(provider)
  expect(await session.send(tx)).toBe(`0x${'a'.repeat(64)}`)
  expect(provider.sent()).toHaveLength(1)
  expect(provider.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'eth_call',
      params: [expect.objectContaining({ from: account, to: registry, value: '0x5' }), 'latest'],
    }),
  )

  provider.setChain(1)
  const changed = await session.send(tx).catch((error: unknown) => error)
  expect(changed).toMatchObject({ code: 'wallet-changed' })
  provider.setChain(chainId)

  const reverting = wallet({
    eth_call: () => {
      throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x' })
    },
  })
  const failed = await (await client().connect(reverting)).send(tx).catch((error) => error)
  expect(failed).toBeInstanceOf(LedgerError)
  expect(failed).toMatchObject({ code: 'not-sent', cause: expect.anything() })
  expect(reverting.sent(), 'A failed simulation reaches no send').toHaveLength(0)
})

it('separates a rejected send from an unknown outcome', async () => {
  rpc({})
  const rejecting = wallet({
    eth_sendTransaction: () => {
      throw Object.assign(new Error('User rejected'), { code: 4001 })
    },
  })
  await expect((await client().connect(rejecting)).send(tx)).rejects.toMatchObject({
    code: 'rejected',
  })
  const lost = wallet({
    eth_sendTransaction: () => {
      throw new Error('Connection lost')
    },
  })
  const error = await (await client().connect(lost)).send(tx).catch((error: unknown) => error)
  expect(error, 'After the send request, failures stay unknown').not.toBeInstanceOf(LedgerError)
})

it('types wallets and namespaces from the ledger', () => {
  expectTypeOf<EIP1193Provider>().toMatchTypeOf<Namespaces['eip155']['wallet']>()
  expectTypeOf<NamespaceOf<(typeof ledgers)['eden-testnet']>>().toEqualTypeOf<'eip155'>()
  // @ts-expect-error every supported namespace needs an implementation
  const missing: Query<[], number> = {}
  expect(missing).toEqual({})
})
