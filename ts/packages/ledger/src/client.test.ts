/**
 * The contract every ledger family's client must meet, run against each family's harness.
 * A family without a harness does not compile.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Command, connect, type Families, indexer, LedgerError, type Query } from './client.js'
import type { Fake, Harness } from './conformance.harness.js'
import { evm } from './evm/evm.harness.js'
import { defineLedger, type Family, Ledgers } from './index.js'

const harnesses: { [F in Family]: Harness<F> } = { evm }

afterEach(() => vi.restoreAllMocks())

it('requires every family to implement each query and command', () => {
  // @ts-expect-error a query needs an implementation for every family
  const query: Query<[], number> = {}
  // @ts-expect-error a command needs an implementation for every family
  const command: Command<[]> = {}
  expect([query, command]).toEqual([{}, {}])
})

it('serves pinned ledgers only as defined, with their public endpoints by default', () => {
  const eden = Ledgers.EdenTestnet
  expect(() => connect({ ledgers: [{ ledger: eden }] })).not.toThrow()
  const altered = defineLedger({
    chain: eden.chain,
    name: eden.name,
    testnet: eden.testnet,
    currency: eden.currency,
    notary: eden.notaryAddress(),
    addresses: { identityNames: `0x${'9'.repeat(40)}` },
  })
  expect(() => connect({ ledgers: [{ ledger: altered, rpc: 'https://rpc.example/' }] })).toThrow(
    /pinned/,
  )
})

it('requires an RPC for a ledger without a public one, and valid endpoints', () => {
  const local = defineLedger({
    chain: 'eip155:31337',
    name: 'Local',
    testnet: true,
    currency: { symbol: 'ETH', decimals: 18 },
    notary: 'http://localhost:4687',
    addresses: {},
  })
  expect(() => connect({ ledgers: [{ ledger: local }] })).toThrow(/no public RPC/)
  expect(() =>
    connect({ ledgers: [{ ledger: local, rpc: 'http://127.0.0.1:8545' }] }),
  ).not.toThrow()
  for (const endpoints of [
    { rpc: 'http://rpc.example' },
    { rpc: 'rpc' },
    { rpc: 'http://127.0.0.1:8545', explorer: 'explorer' },
  ]) {
    expect(() => connect({ ledgers: [{ ledger: local, ...endpoints }] })).toThrow(
      /Invalid endpoint/,
    )
  }
})

/**
 * The same family's client, with a default indexer that never answers, must meet the contract:
 * only queries with an indexer implementation depend on the indexer.
 */
const behindUnavailableIndexer = <F extends Family>(harness: Harness<F>): Harness<F> => ({
  setup() {
    const fake = harness.setup()
    const [deployment] = Object.keys(fake.ledger.addresses)
    const unavailable = indexer({ origin: 'https://indexer.invalid', deployment })
    return Object.assign(fake, {
      client: connect({ ledgers: [fake.access], indexer: unavailable }),
    })
  },
})

function run<F extends Family>(family: F) {
  conformance(family, harnesses[family])
  conformance(family, behindUnavailableIndexer(harnesses[family]), {
    variant: 'behind an unavailable indexer',
    unavailableIndexer: true,
  })
}
for (const family of Object.keys(harnesses) as Family[]) run(family)

function conformance<F extends Family>(
  family: F,
  harness: Harness<F>,
  { variant = '', unavailableIndexer = false } = {},
) {
  const query = <A extends unknown[], R>(
    run: (read: Families[F]['reader'], ...args: A) => Promise<R>,
  ) => ({ [family]: run }) as unknown as Query<A, R>
  const probe = (fake: Fake<F>) => query(async (read) => fake.probe(read))
  const connected = (fake: Fake<F>) => fake.client.connect(fake.ledger, fake.wallet)
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('Expected a failure')
      },
      (error: unknown) => error,
    )

  describe(`${family} ledger client ${variant}`.trim(), () => {
    describe('ledgers', () => {
      it('serves several ledgers, each with its own state', async () => {
        const [a, b] = [harness.setup(), harness.setup()]
        const client = connect({ ledgers: [a.access, b.access] })
        expect(client.ledgers).toEqual([a.ledger, b.ledger])
        const before = await Promise.all(
          [a, b].map((fake) => client.read(fake.ledger, probe(fake), [])),
        )
        a.advance()
        expect(await client.read(a.ledger, probe(a), [])).not.toEqual(before[0])
        expect(await client.read(b.ledger, probe(b), []), 'Other ledgers do not move').toEqual(
          before[1],
        )
      })

      it('finds a served ledger by chain identifier, such as one a wallet reports', () => {
        const fake = harness.setup()
        expect(fake.client.ledger(fake.ledger.chain)).toBe(fake.ledger)
        expect(fake.client.ledger('unknown:1')).toBeUndefined()
      })

      it('refuses ledgers it does not serve, and two entries for one chain', async () => {
        const [fake, other] = [harness.setup(), harness.setup()]
        await expect(fake.client.read(other.ledger, probe(other), [])).rejects.toThrow(TypeError)
        expect(() => connect({ ledgers: [fake.access, fake.access] })).toThrow(TypeError)
      })

      it('describes what wallets must approve, per namespace', () => {
        const [a, b] = [harness.setup(), harness.setup()]
        const { walletRequirements } = connect({ ledgers: [a.access, b.access] })
        const namespace = a.ledger.chain.slice(0, a.ledger.chain.indexOf(':'))
        expect(walletRequirements[namespace].chains).toEqual([a.ledger.chain, b.ledger.chain])
        for (const list of [
          walletRequirements[namespace].methods,
          walletRequirements[namespace].events,
        ]) {
          expect(list.length).toBeGreaterThan(0)
          expect(list.every((item) => typeof item === 'string' && item !== '')).toBe(true)
        }
      })

      it('serves a ledger through another client', async () => {
        const fake = harness.setup()
        const client = connect({ ledgers: [{ ledger: fake.ledger, client: fake.client }] })
        expect(await client.read(fake.ledger, probe(fake), [])).toEqual(
          await fake.client.read(fake.ledger, probe(fake), []),
        )
        expect((await client.connect(fake.ledger, fake.wallet)).account).toBe(
          fake.accounts.canonical,
        )
      })
    })

    describe('read', () => {
      it("runs the family's implementation with the given arguments", async () => {
        const { client, ledger } = harness.setup()
        const concat = query(async (_, a: number, b: string) => `${a}${b}`)
        expect(await client.read(ledger, concat, [1, 'x'])).toBe('1x')
      })

      it('sees one chain state for the whole query', async () => {
        const fake = harness.setup()
        const twice = query(async (read) => {
          const first = await fake.probe(read)
          fake.advance()
          return [first, await fake.probe(read)]
        })
        const [first, second] = await fake.client.read(fake.ledger, twice, [])
        expect(second, 'A query never sees two states').toEqual(first)
        const [later] = await fake.client.read(fake.ledger, twice, [])
        expect(later, 'A later query sees the new state').not.toEqual(first)
      })

      it(
        unavailableIndexer
          ? 'fails a query with an indexer implementation, without falling back to the chain'
          : 'runs the chain implementation on a ledger without an indexer',
        async () => {
          const { client, ledger } = harness.setup()
          const both = { ...query(async () => 'chain'), indexer: async () => 'indexer' }
          const answer = client.read(ledger, both as Query<[], string>, [])
          if (unavailableIndexer) {
            await expect(answer).rejects.toMatchObject({ code: 'indexer-unavailable' })
          } else {
            expect(await answer).toBe('chain')
          }
        },
      )

      it('stops when its signal aborts', async () => {
        const fake = harness.setup()
        let ran = false
        const noted = query(async () => {
          ran = true
        })
        await expect(
          fake.client.read(fake.ledger, noted, [], { signal: AbortSignal.abort() }),
        ).rejects.toThrow()
        expect(ran, 'An aborted read does not start its query').toBe(false)
        const controller = new AbortController()
        const midway = query(async (read) => {
          controller.abort()
          return fake.probe(read)
        })
        await expect(
          fake.client.read(fake.ledger, midway, [], { signal: controller.signal }),
        ).rejects.toThrow()
      })

      it('propagates query failures unchanged', async () => {
        const { client, ledger } = harness.setup()
        const cause = new Error('query failed')
        const throwing = query(async () => {
          throw cause
        })
        expect(await failure(client.read(ledger, throwing, []))).toBe(cause)
      })
    })

    it("builds a command's transaction for its ledger", () => {
      const fake = harness.setup()
      const command = {
        [family]: (ledger: unknown, value: number) => {
          expect(ledger).toBe(fake.ledger)
          expect(value).toBe(7)
          return fake.tx
        },
      } as unknown as Command<[number]>
      expect(fake.client.tx(fake.ledger, command, [7])).toBe(fake.tx)
    })

    it('estimates a network fee in native units', async () => {
      const { client, ledger, tx, accounts } = harness.setup()
      const fee = await client.estimate(ledger, tx, client.parseAccount(ledger, accounts.raw))
      expect(typeof fee).toBe('bigint')
      expect(fee).toBeGreaterThanOrEqual(0n)
    })

    it('canonicalizes accounts and rejects invalid ones', () => {
      const { client, ledger, accounts } = harness.setup()
      expect(client.parseAccount(ledger, accounts.raw)).toBe(accounts.canonical)
      expect(client.parseAccount(ledger, accounts.canonical)).toBe(accounts.canonical)
      expect(client.parseAccount(ledger, accounts.other)).not.toBe(accounts.canonical)
      expect(() => client.parseAccount(ledger, accounts.invalid)).toThrow()
    })

    describe('connect', () => {
      it('restores an authorized wallet on this chain without prompting', async () => {
        const fake = harness.setup()
        const session = await fake.client.connect(fake.ledger, fake.wallet, { prompt: false })
        expect(session.account).toBe(fake.accounts.canonical)
        expect(session.ledger).toBe(fake.ledger)
        expect(fake.prompts).toBe(0)
      })

      it('refuses to restore without an account or on another chain, without prompting', async () => {
        const none = harness.setup()
        none.shareAccount(null)
        const noAccount = await failure(
          none.client.connect(none.ledger, none.wallet, { prompt: false }),
        )
        expect(noAccount).toBeInstanceOf(LedgerError)
        expect(noAccount).toMatchObject({ code: 'no-account' })
        const elsewhere = harness.setup()
        elsewhere.leaveChain()
        const wrongChain = await failure(
          elsewhere.client.connect(elsewhere.ledger, elsewhere.wallet, { prompt: false }),
        )
        expect(wrongChain).toMatchObject({ code: 'wrong-chain' })
        expect(none.prompts + elsewhere.prompts).toBe(0)
      })

      it('asks the wallet when prompting, and reports a decline as rejected', async () => {
        const fake = harness.setup()
        expect((await connected(fake)).account).toBe(fake.accounts.canonical)
        expect(fake.prompts).toBeGreaterThan(0)
        fake.decline('accounts')
        expect(await failure(connected(fake))).toMatchObject({ code: 'rejected' })
      })
    })

    describe('session', () => {
      it("reads through the connected wallet, and the ledger's RPC otherwise", async () => {
        const fake = harness.setup()
        const before = await fake.client.read(fake.ledger, probe(fake), [])
        expect(fake.walletReads, 'Without a wallet, the RPC answers').toBe(0)
        const session = await connected(fake)
        expect(await fake.client.read(fake.ledger, probe(fake), [])).toEqual(before)
        const served = fake.walletReads
        expect(served, 'A connected wallet answers').toBeGreaterThan(0)
        session.close()
        await fake.client.read(fake.ledger, probe(fake), [])
        expect(fake.walletReads, 'After closing, the RPC answers again').toBe(served)
      })

      it("estimates through the session's wallet", async () => {
        const fake = harness.setup()
        const session = await connected(fake)
        await expect(session.estimate(fake.tx)).resolves.toBeTypeOf('bigint')
      })

      it('sends a transaction once and returns its identifier', async () => {
        const fake = harness.setup()
        const id = await (await connected(fake)).send(fake.tx)
        expect(id).toBeTypeOf('string')
        expect(id).not.toBe('')
        expect(fake.sent).toBe(1)
      })

      for (const change of ['account', 'chain'] as const) {
        it(`sends nothing after the wallet ${change} changed`, async () => {
          const fake = harness.setup()
          const session = await connected(fake)
          if (change === 'account') fake.shareAccount(fake.accounts.other)
          else fake.leaveChain()
          const error = await failure(session.send(fake.tx))
          expect(error).toBeInstanceOf(LedgerError)
          expect(error).toMatchObject({ code: 'wallet-changed' })
          expect(fake.sent).toBe(0)
        })
      }

      it('sends nothing when simulation fails', async () => {
        const fake = harness.setup()
        const error = await failure((await connected(fake)).send(fake.reverting))
        expect(error).toBeInstanceOf(LedgerError)
        expect(error).toMatchObject({ code: 'not-sent', cause: expect.anything() })
        expect(fake.sent).toBe(0)
      })

      it('reports a declined send as rejected', async () => {
        const fake = harness.setup()
        const session = await connected(fake)
        fake.decline('send')
        expect(await failure(session.send(fake.tx))).toMatchObject({ code: 'rejected' })
        expect(fake.sent).toBe(0)
      })

      it('leaves a send that failed after reaching the wallet unknown', async () => {
        const fake = harness.setup()
        const session = await connected(fake)
        fake.loseSend()
        const error = await failure(session.send(fake.tx))
        expect(error, 'Only a LedgerError promises that nothing was sent').not.toBeInstanceOf(
          LedgerError,
        )
      })

      it('leaves the client usable after closing', async () => {
        const fake = harness.setup()
        const session = await connected(fake)
        session.close()
        session.close()
        await expect(fake.client.read(fake.ledger, probe(fake), [])).resolves.toBeDefined()
      })
    })
  })
}
