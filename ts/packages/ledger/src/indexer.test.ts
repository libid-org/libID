import { EventEmitter } from 'node:events'
import { toHex } from 'viem'
import { afterEach, expect, it, vi } from 'vitest'
import { connect, type IndexerAccess, type Query } from './client.js'
import { defineLedger } from './index.js'

const chainId = 3735928814
const rpc = 'https://rpc.example/'
const origin = 'https://indexer.example'
const registry = '0x2222222222222222222222222222222222222222'
const ledger = defineLedger({
  chain: `eip155:${chainId}`,
  name: 'Test',
  testnet: true,
  currency: { symbol: 'TIA', decimals: 18 },
  notary: 'http://localhost:4687',
  addresses: { identityNames: registry },
})
const access = { deployment: 'identityNames', origin } satisfies IndexerAccess

type Status = Record<string, unknown>
const current: Status = {
  chainId,
  contract: registry.toUpperCase().replace('0X', '0x'),
  lastIndexedBlock: 14,
  chainHeadBlock: 16,
  lagBlocks: 2,
  reportValidFor: 30,
  lastWindowError: null,
}

/** Serves the chain over JSON-RPC and the indexer over HTTP; `statuses` answer in turn. */
function serve(statuses: (Status | Response)[] = [current], value: unknown = { value: 'indexed' }) {
  const requests: { url: string; init?: RequestInit }[] = []
  let calls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === rpc) {
      const { id, method } = JSON.parse(String(init?.body))
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: method === 'eth_blockNumber' ? '0x10' : '0x',
      })
    }
    requests.push({ url, init })
    if (url === `${origin}/v1/status`) {
      const status = statuses[Math.min(calls++, statuses.length - 1)]
      return status instanceof Response ? status : Response.json({ chains: [status] })
    }
    return Response.json(value)
  })
  return requests
}

/** Tells which source answered, and at which chain state. */
const source: Query<[string], { source: string; block: bigint; value?: unknown }> = {
  evm: async (read) => ({ source: 'chain', block: read.block }),
  indexer: async (read, chain) => ({
    source: 'indexer',
    block: read.block,
    value: (await read.get('/v1/value', { chain })).value,
  }),
}

afterEach(() => vi.restoreAllMocks())

it('reads a current indexer for queries that support it', async () => {
  const requests = serve()
  const client = connect(ledger, { rpc, indexer: access })
  expect(await client.read(source, [String(chainId)])).toEqual({
    source: 'indexer',
    block: 14n,
    value: 'indexed',
  })
  expect(requests.map(({ url }) => url)).toEqual([
    `${origin}/v1/status`,
    `${origin}/v1/value?chain=${chainId}`,
    `${origin}/v1/status`,
  ])
  expect(requests[1].init).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
})

it('reads the chain for queries without an indexer implementation, or without an indexer', async () => {
  serve()
  const chainOnly: Query<[], string> = { evm: async () => 'chain' }
  expect(await connect(ledger, { rpc, indexer: access }).read(chainOnly, [])).toBe('chain')
  expect((await connect(ledger, { rpc }).read(source, ['x'])).source).toBe('chain')
})

it.each([
  ['is behind', { ...current, lagBlocks: 21 }],
  ['is further behind the head than it reports', { ...current, chainHeadBlock: 40 }],
  ['indexes another chain', { ...current, chainId: 1 }],
  ['indexes another deployment', { ...current, contract: `0x${'4'.repeat(40)}` }],
  ['reports a window error', { ...current, lastWindowError: 'rpc timeout' }],
  ['reports an expired status', { ...current, reportValidFor: 0 }],
  ['fails', new Response('down', { status: 503 })],
])('falls back to the chain when the indexer %s', async (_, status) => {
  serve([status])
  expect((await connect(ledger, { rpc, indexer: access }).read(source, ['x'])).source).toBe('chain')
})

it('falls back to the chain when the index moves backwards during the read', async () => {
  serve([current, { ...current, lastIndexedBlock: 13 }])
  expect((await connect(ledger, { rpc, indexer: access }).read(source, ['x'])).source).toBe('chain')
})

it('falls back to the chain when the indexer answers with something other than an object', async () => {
  serve([current], ['not', 'an', 'object'])
  expect((await connect(ledger, { rpc, indexer: access }).read(source, ['x'])).source).toBe('chain')
})

it('propagates an abort instead of falling back', async () => {
  serve()
  const controller = new AbortController()
  const aborting: Query<[], string> = {
    evm: async () => 'chain',
    indexer: async () => {
      controller.abort()
      throw new Error('stopped')
    },
  }
  await expect(
    connect(ledger, { rpc, indexer: access }).read(aborting, [], { signal: controller.signal }),
  ).rejects.toThrow()
})

it('reads the indexer from wallet sessions too', async () => {
  serve()
  const wallet = Object.assign(new EventEmitter(), {
    async request({ method }: { method: string }) {
      if (method === 'eth_chainId') return toHex(chainId)
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [registry]
      throw Object.assign(new Error(`No ${method}`), { code: 4200 })
    },
  })
  const session = await connect(ledger, { rpc, indexer: access }).connect(wallet)
  expect((await session.read(source, ['x'])).source).toBe('indexer')
  expect(session.account).toBe(registry)
})

it.each([
  ['a plain HTTP origin', { ...access, origin: 'http://indexer.example' }],
  ['an origin with a path', { ...access, origin: `${origin}/api` }],
  ['an unknown deployment', { ...access, deployment: 'verifier' }],
  ['a negative lag', { ...access, maxLag: -1 }],
])('rejects an indexer with %s', (_, indexer) => {
  expect(() => connect(ledger, { rpc, indexer })).toThrow(TypeError)
})
