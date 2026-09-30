/**
 * The contract every ledger family's client must meet, run against each family's harness.
 * A family without a harness does not compile.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Command, type Families, LedgerError, type Query } from './client.js'
import type { Fake, Harness } from './conformance.harness.js'
import { evm } from './evm/evm.harness.js'
import type { Family } from './index.js'

const harnesses: { [F in Family]: Harness<F> } = { evm }

afterEach(() => vi.restoreAllMocks())

it('requires every family to implement each query and command', () => {
  // @ts-expect-error a query needs an implementation for every family
  const query: Query<[], number> = {}
  // @ts-expect-error a command needs an implementation for every family
  const command: Command<[]> = {}
  expect([query, command]).toEqual([{}, {}])
})

function run<F extends Family>(family: F) {
  conformance(family, harnesses[family])
}
for (const family of Object.keys(harnesses) as Family[]) run(family)

function conformance<F extends Family>(family: F, harness: Harness<F>) {
  const query = <A extends unknown[], R>(
    run: (read: Families[F]['reader'], ...args: A) => Promise<R>,
  ) => ({ [family]: run }) as unknown as Query<A, R>
  const probe = (fake: Fake<F>) => query(async (read) => fake.probe(read))
  const connected = async (fake: Fake<F>) => fake.client.connect(fake.wallet)
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('Expected a failure')
      },
      (error: unknown) => error,
    )

  describe(`${family} ledger client`, () => {
    it('describes its family and what a wallet session needs', () => {
      const { client } = harness.setup()
      expect(client.family).toBe(family)
      for (const list of [client.walletRequirements.methods, client.walletRequirements.events]) {
        expect(list.length).toBeGreaterThan(0)
        expect(list.every((item) => typeof item === 'string' && item !== '')).toBe(true)
      }
    })

    describe('read', () => {
      it("runs the family's implementation with the given arguments", async () => {
        const { client } = harness.setup()
        const concat = query(async (_, a: number, b: string) => `${a}${b}`)
        expect(await client.read(concat, [1, 'x'])).toBe('1x')
      })

      it('sees one chain state for the whole query', async () => {
        const fake = harness.setup()
        const twice = query(async (read) => {
          const first = await fake.probe(read)
          fake.advance()
          return [first, await fake.probe(read)]
        })
        const [first, second] = await fake.client.read(twice, [])
        expect(second, 'A query never sees two states').toEqual(first)
        const [later] = await fake.client.read(twice, [])
        expect(later, 'A later query sees the new state').not.toEqual(first)
      })

      it('stops when its signal aborts', async () => {
        const fake = harness.setup()
        let ran = false
        const noted = query(async () => {
          ran = true
        })
        await expect(fake.client.read(noted, [], { signal: AbortSignal.abort() })).rejects.toThrow()
        expect(ran, 'An aborted read does not start its query').toBe(false)
        const controller = new AbortController()
        const midway = query(async (read) => {
          controller.abort()
          return fake.probe(read)
        })
        await expect(fake.client.read(midway, [], { signal: controller.signal })).rejects.toThrow()
      })

      it('propagates query failures unchanged', async () => {
        const { client } = harness.setup()
        const cause = new Error('query failed')
        const throwing = query(async () => {
          throw cause
        })
        expect(await failure(client.read(throwing, []))).toBe(cause)
      })
    })

    it("builds a command's transaction for its ledger", () => {
      const fake = harness.setup()
      const command = {
        [family]: (ledger: unknown, value: number) => {
          expect(ledger).toBe(fake.client.ledger)
          expect(value).toBe(7)
          return fake.tx
        },
      } as unknown as Command<[number]>
      expect(fake.client.tx(command, [7])).toBe(fake.tx)
    })

    it('estimates a network fee in native units', async () => {
      const fake = harness.setup()
      const fee = await fake.client.estimate(fake.tx, fake.client.parseAccount(fake.accounts.raw))
      expect(typeof fee).toBe('bigint')
      expect(fee).toBeGreaterThanOrEqual(0n)
    })

    it('canonicalizes accounts and rejects invalid ones', () => {
      const { client, accounts } = harness.setup()
      expect(client.parseAccount(accounts.raw)).toBe(accounts.canonical)
      expect(client.parseAccount(accounts.canonical)).toBe(accounts.canonical)
      expect(client.parseAccount(accounts.other)).not.toBe(accounts.canonical)
      expect(() => client.parseAccount(accounts.invalid)).toThrow()
    })

    describe('connect', () => {
      it('restores an authorized wallet on this chain without prompting', async () => {
        const fake = harness.setup()
        const session = await fake.client.connect(fake.wallet, { prompt: false })
        expect(session.account).toBe(fake.accounts.canonical)
        expect(session.ledger).toBe(fake.client.ledger)
        expect(fake.prompts).toBe(0)
      })

      it('refuses to restore without an account or on another chain, without prompting', async () => {
        const none = harness.setup()
        none.shareAccount(null)
        const noAccount = await failure(none.client.connect(none.wallet, { prompt: false }))
        expect(noAccount).toBeInstanceOf(LedgerError)
        expect(noAccount).toMatchObject({ code: 'no-account' })
        const elsewhere = harness.setup()
        elsewhere.leaveChain()
        const wrongChain = await failure(
          elsewhere.client.connect(elsewhere.wallet, { prompt: false }),
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
      it('reads, parses and estimates like its client', async () => {
        const fake = harness.setup()
        const session = await connected(fake)
        await expect(session.read(probe(fake), [])).resolves.toEqual(
          await fake.client.read(probe(fake), []),
        )
        expect(session.parseAccount(fake.accounts.raw)).toBe(fake.accounts.canonical)
        expect(session.walletRequirements).toEqual(fake.client.walletRequirements)
        await expect(session.estimate(fake.tx, session.account)).resolves.toBeTypeOf('bigint')
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
        await expect(fake.client.read(probe(fake), [])).resolves.toBeDefined()
      })
    })
  })
}
