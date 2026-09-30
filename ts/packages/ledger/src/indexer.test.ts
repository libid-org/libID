import { EventEmitter } from 'node:events'
import { toHex } from 'viem'
import { afterEach, expect, it, vi } from 'vitest'
import { connect, type Indexer, indexer, type LedgerClient, type Query } from './client.js'
import { defineLedger, type Ledger } from './index.js'

const origin = 'https://indexer.example'
const registry = '0x2222222222222222222222222222222222222222'
const ledgerOn = (id: number) =>
  defineLedger({
    chain: `eip155:${id}`,
    name: `Chain ${id}`,
    testnet: true,
    currency: { symbol: 'TIA', decimals: 18 },
    notary: 'http://localhost:4687',
    addresses: { identityNames: registry },
  })
const eden = ledgerOn(4242)
const rpcOf = (ledger: Ledger) => `https://rpc.example/${ledger.chain}`
const names = (at = origin) => indexer({ origin: at, deployment: 'identityNames' })
const clientOf = (ledger: Ledger = eden, source: Indexer = names()) =>
  connect({ ledgers: [{ ledger, rpc: rpcOf(ledger) }], indexer: source })

type Status = Record<string, unknown>
const statusOf = (ledger: Ledger, overrides: Status = {}): Status => ({
  chainId: Number(ledger.chain.split(':')[1]),
  contract: registry.toUpperCase().replace('0X', '0x'),
  lastIndexedBlock: 14,
  chainHeadBlock: 16,
  lagBlocks: 2,
  reportValidFor: 30,
  lastWindowError: null,
  ...overrides,
})

/**
 * Serves chains over JSON-RPC and indexers over HTTP. Status requests answer from
 * `statuses` in turn; other indexer requests answer `value`, or the indexer's origin.
 */
function serve(statuses: (Status | Status[] | Response)[] = [statusOf(eden)], value?: unknown) {
  const requests: { url: string; init?: RequestInit }[] = []
  let calls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.origin === 'https://rpc.example') {
      const { id, method } = JSON.parse(String(init?.body))
      const result = method === 'eth_blockNumber' ? '0x10' : '0x'
      return Response.json({ jsonrpc: '2.0', id, result })
    }
    requests.push({ url: url.href, init })
    if (init?.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
    if (url.pathname === '/v1/status') {
      const status = statuses[Math.min(calls++, statuses.length - 1)]
      if (status instanceof Response) return status.clone()
      return Response.json({ chains: Array.isArray(status) ? status : [status] })
    }
    return Response.json(value ?? { value: url.origin })
  })
  return requests
}

/** Tells which source answered, and at which chain state. */
const source: Query<[], { source: string; block?: bigint; value?: unknown }> = {
  evm: async (read) => ({ source: 'chain', block: read.block }),
  indexer: async (read) => ({
    source: 'indexer',
    block: read.block,
    value: (await read.get('/v1/value', { chain: read.ledger.chain })).value,
  }),
}

afterEach(() => vi.restoreAllMocks())

it('reads a current indexer for queries that support it', async () => {
  const requests = serve()
  expect(await clientOf().read(eden, source, [])).toEqual({
    source: 'indexer',
    block: 14n,
    value: origin,
  })
  expect(requests.map(({ url }) => url)).toEqual([
    `${origin}/v1/status`,
    `${origin}/v1/value?chain=eip155%3A4242`,
    `${origin}/v1/status`,
  ])
  expect(requests[1].init).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
})

it('reads the chain for queries without an indexer implementation, or on ledgers without one', async () => {
  serve()
  const chainOnly: Query<[], string> = { evm: async () => 'chain' }
  expect(await clientOf().read(eden, chainOnly, [])).toBe('chain')
  const bare = connect({ ledgers: [{ ledger: eden, rpc: rpcOf(eden) }] })
  expect((await bare.read(eden, source, [])).source).toBe('chain')
})

it.each([
  ['is behind', statusOf(eden, { lagBlocks: 21 })],
  ['is further behind the head than it reports', statusOf(eden, { chainHeadBlock: 40 })],
  ['does not report this chain', statusOf(ledgerOn(1))],
  ['indexes another deployment', statusOf(eden, { contract: `0x${'4'.repeat(40)}` })],
  ['reports a window error', statusOf(eden, { lastWindowError: 'rpc timeout' })],
  ['reports an expired status', statusOf(eden, { reportValidFor: 0 })],
  ['fails', new Response('down', { status: 503 })],
])('fails without falling back when the indexer %s', async (_, status) => {
  serve([status])
  await expect(clientOf().read(eden, source, [])).rejects.toMatchObject({
    code: 'indexer-unavailable',
  })
})

it('fails when the index moves backwards during the read', async () => {
  serve([statusOf(eden), statusOf(eden, { lastIndexedBlock: 13 })])
  await expect(clientOf().read(eden, source, [])).rejects.toMatchObject({
    code: 'indexer-unavailable',
  })
})

it('fails when the indexer answers with something other than an object', async () => {
  serve([statusOf(eden)], ['not', 'an', 'object'])
  await expect(clientOf().read(eden, source, [])).rejects.toMatchObject({
    code: 'indexer-unavailable',
  })
})

it("propagates a query's own indexer errors unchanged", async () => {
  serve()
  const cause = new Error('Invalid identity list.')
  const strict: Query<[], never> = {
    evm: async () => {
      throw new Error('not reached')
    },
    indexer: async () => {
      throw cause
    },
  }
  await expect(clientOf().read(eden, strict, [])).rejects.toBe(cause)
})

it("propagates the caller's abort as an abort, not as an unavailable indexer", async () => {
  serve()
  const controller = new AbortController()
  const aborting: Query<[], unknown> = {
    evm: async () => 'chain',
    indexer: async (read) => {
      controller.abort()
      return read.get('/v1/value')
    },
  }
  const error = await clientOf()
    .read(eden, aborting, [], { signal: controller.signal })
    .catch((error: unknown) => error)
  expect(error).toMatchObject({ name: 'AbortError' })
})

it('reads the indexer while a wallet is connected', async () => {
  serve()
  const wallet = Object.assign(new EventEmitter(), {
    async request({ method }: { method: string }) {
      if (method === 'eth_chainId') return toHex(4242)
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [registry]
      throw Object.assign(new Error(`No ${method}`), { code: 4200 })
    },
  })
  const client = clientOf()
  const session = await client.connect(eden, wallet)
  expect((await client.read(eden, source, [])).source).toBe('indexer')
  expect(session.account).toBe(registry)
})

it('serves every chain it reports from one indexer', async () => {
  const local = ledgerOn(31337)
  serve([[statusOf(eden), statusOf(local, { lastIndexedBlock: 9, chainHeadBlock: 9 })]])
  const client = connect({
    ledgers: [eden, local].map((ledger) => ({ ledger, rpc: rpcOf(ledger) })),
    indexer: names(),
  })
  expect(await client.read(eden, source, [])).toMatchObject({ source: 'indexer', block: 14n })
  expect(await client.read(local, source, [])).toMatchObject({ source: 'indexer', block: 9n })
})

it('composes a default indexer with per-ledger overrides', async () => {
  const [a, b, c, d] = [4242, 1, 31337, 10].map(ledgerOn)
  serve([[a, b, c, d].map((ledger) => statusOf(ledger))])
  const other = 'https://other-indexer.example'
  const base = connect({ ledgers: [{ ledger: d, rpc: rpcOf(d) }] })
  const custom = { ...base, read: async () => ({ source: 'custom' }) } as LedgerClient
  const client = connect({
    ledgers: [
      { ledger: a, rpc: rpcOf(a) },
      { ledger: b, rpc: rpcOf(b), indexer: names(other) },
      { ledger: c, rpc: rpcOf(c), indexer: false },
      { ledger: d, client: custom, indexer: false },
    ],
    indexer: names(),
  })
  const answers = await Promise.all([a, b, c, d].map((ledger) => client.read(ledger, source, [])))
  expect(answers.map(({ source, value }) => value ?? source)).toEqual([
    origin,
    other,
    'chain',
    'custom',
  ])
})

it('rejects an invalid indexer, or a ledger without its deployment', () => {
  for (const options of [
    { origin: 'http://indexer.example', deployment: 'identityNames' },
    { origin: `${origin}/api`, deployment: 'identityNames' },
    { origin, deployment: 'identityNames', maxLag: -1 },
  ]) {
    expect(() => indexer(options)).toThrow(TypeError)
  }
  expect(() => clientOf(eden, indexer({ origin, deployment: 'verifier' }))).toThrow(
    /no verifier address/,
  )
})
