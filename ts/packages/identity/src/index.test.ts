import { defineLedger, Ledgers } from '@libid/ledger'
import { connect } from '@libid/ledger/client'
import { expect, expectTypeOf, it } from 'vitest'
import { createIdentityClient, type IdentityLedger } from './index.js'

const eden = Ledgers.EdenTestnet
const sepolia = Ledgers.Sepolia
const anvil = defineLedger({
  chain: 'eip155:31337',
  name: 'Anvil',
  testnet: true,
  currency: { symbol: 'ETH', decimals: 18 },
  notary: 'http://localhost:4687',
  addresses: { identityRegistry: `0x${'2'.repeat(40)}` },
})
const local = 'http://127.0.0.1:8545'
const recipient = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'
const fee = { amount: 10n ** 15n, recipient }

it('serves every pinned ledger with no configuration', () => {
  const client = createIdentityClient()
  expect(client.ledgers).toEqual([eden, sepolia])
  expect(client.ledger(sepolia.chain)).toBe(sepolia)
  expect(client.ledger('eip155:1')).toBeUndefined()
  expect(client.walletRequirements.eip155.chains).toEqual([eden.chain, sepolia.chain])
  expect(client.fee(eden), 'libID charges no fee of its own').toBeUndefined()
})

it('configures pinned ledgers and adds others from one list', () => {
  const client = createIdentityClient({
    ledgers: [
      { ledger: eden, fee, rpc: 'https://my-rpc.example/' },
      { ledger: anvil, rpc: local, indexer: false },
    ],
  })
  expect(client.ledgers).toEqual([eden, sepolia, anvil])
  expect(client.fee(eden)).toEqual({
    amount: 10n ** 15n,
    recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  })
  expect(client.fee(anvil)).toBeUndefined()
  expect(client.fee(sepolia), 'Only configured ledgers charge a fee').toBeUndefined()
  expectTypeOf(client.ledger('eip155:31337')).toEqualTypeOf<
    typeof eden | typeof sepolia | typeof anvil | undefined
  >()
})

it('leaves pinned ledgers out on request', () => {
  const client = createIdentityClient({ exclude: [eden], ledgers: [{ ledger: anvil, rpc: local }] })
  expect(client.ledgers).toEqual([sepolia, anvil])
  expect(() => createIdentityClient({ exclude: [eden], ledgers: [{ ledger: eden, fee }] })).toThrow(
    /both configured and excluded/,
  )
})

it('reaches a pinned ledger through another client', () => {
  const other = connect({ ledgers: [{ ledger: eden }] })
  expect(createIdentityClient({ ledgers: [{ ledger: eden, client: other }] }).ledgers).toEqual([
    eden,
    sepolia,
  ])
})

it("never changes a pinned ledger's definition", () => {
  const altered = defineLedger({
    chain: eden.chain,
    name: eden.name,
    testnet: eden.testnet,
    currency: eden.currency,
    notary: eden.notaryAddress(),
    addresses: { identityRegistry: `0x${'9'.repeat(40)}` },
  })
  expect(() =>
    createIdentityClient({ ledgers: [{ ledger: altered, rpc: 'https://rpc.example/' }] }),
  ).toThrow(/pinned/)
})

it('rejects two entries for one ledger', () => {
  expect(() =>
    createIdentityClient({ ledgers: [{ ledger: eden }, { ledger: eden, fee }] }),
  ).toThrow(/More than one entry/)
})

it('requires an identity registry on every ledger, and valid endpoints', () => {
  const bare = defineLedger({ ...anvil, notary: 'http://localhost:4687', addresses: {} })
  // @ts-expect-error a ledger without identityRegistry is not an IdentityLedger
  expect(() => createIdentityClient({ ledgers: [{ ledger: bare, rpc: local }] })).toThrow(
    /no identityRegistry address/,
  )
  expect(() => createIdentityClient({ ledgers: [{ ledger: anvil }] }), 'Wallet-only').not.toThrow()
  expect(() =>
    createIdentityClient({ ledgers: [{ ledger: eden, rpc: 'http://rpc.example' }] }),
  ).toThrow(/Invalid endpoint/)
  expectTypeOf(eden).toMatchTypeOf<IdentityLedger>()
})

it.each([
  ['a zero fee', { amount: 0n, recipient }, /positive amount/],
  ['a negative fee', { amount: -1n, recipient }, /positive amount/],
  ['an invalid recipient', { amount: 1n, recipient: '0x1234' }, /./],
])('rejects %s', (_, fee, message) => {
  expect(() => createIdentityClient({ ledgers: [{ ledger: eden, fee }] })).toThrow(message)
})

it('rejects an invalid names indexer origin', () => {
  expect(() => createIdentityClient({ indexer: 'http://names.example' })).toThrow(TypeError)
  expect(() =>
    createIdentityClient({ ledgers: [{ ledger: eden, indexer: 'https://names.example/v1' }] }),
  ).toThrow(TypeError)
})
