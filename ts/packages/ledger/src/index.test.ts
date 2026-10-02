import { bytesToHex } from '@noble/hashes/utils.js'
import { expect, expectTypeOf, it } from 'vitest'
import { defineLedger, Ledgers } from './index.js'

const hex = (ledger: { hash(): Uint8Array }) => `0x${bytesToHex(ledger.hash())}`
const local = {
  chain: 'eip155:31337',
  name: 'Local',
  testnet: true,
  currency: { symbol: 'ETH', decimals: 18 },
  notary: 'http://localhost:4687',
  addresses: {},
} as const

it('eden testnet matches its deployed verifier', () => {
  const eden = Ledgers.EdenTestnet
  // CeremonyProofVerifier.chainId() at 0x76BDc18f21c2db0FF796C7Cc50348528b2899275, read 2026-10-01.
  expect(hex(eden)).toBe('0x70c29a92a253d6f2a7ee351d43fd44734752ddb392efed6c31d16d3530a7e41c')
  expect(eden.notaryAddress()).toBe('https://testnet.notary.lib.id')
  expect(eden.rpc, 'libID pins no RPC').toBeUndefined()
  expect(eden.explorer).toBe('https://eden-testnet.blockscout.com')
  expectTypeOf(eden.chain).toEqualTypeOf<'eip155:3735928814'>()
  expectTypeOf(
    eden.addresses.identityRegistry,
  ).toEqualTypeOf<'0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366'>()
})

it('sepolia matches its deployed verifier', () => {
  const sepolia = Ledgers.Sepolia
  // CeremonyProofVerifier.chainId() at 0x76BDc18f21c2db0FF796C7Cc50348528b2899275, read 2026-10-01.
  expect(hex(sepolia)).toBe('0x4679aa19497ce87eb9ffd768757c9397680da8c7963db8096790ee03622ae968')
  expect(sepolia.notaryAddress()).toBe('https://testnet.notary.lib.id')
  expect(sepolia.rpc, 'libID pins no RPC').toBeUndefined()
  expect(sepolia.explorer).toBe('https://sepolia.etherscan.io')
  expect(sepolia.addresses.identityRegistry, 'Canonical: the same on every EVM chain').toBe(
    Ledgers.EdenTestnet.addresses.identityRegistry,
  )
})

it('derives eip155 hashes as keccak256(abi.encode(chainId))', () => {
  expect(hex(defineLedger({ ...local, chain: 'eip155:1' }))).toBe(
    '0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6',
  )
  expect(hex(defineLedger(local))).toBe(
    '0xc5bfccff9c3fae70cd5d05bba89b1e2fdcf5d3f1902e09eec8b41c2bb7cf1455',
  )
})

it('returns fresh hash bytes and frozen values', () => {
  const ledger = defineLedger({ ...local, addresses: { registry: `0x${'1'.repeat(40)}` } })
  const expected = ledger.hash()
  ledger.hash().fill(0)
  expect(ledger.hash()).toEqual(expected)
  expect(Object.isFrozen(ledger)).toBe(true)
  expect(Object.isFrozen(ledger.addresses)).toBe(true)
  expect(Object.isFrozen(ledger.currency)).toBe(true)
})

it.each([
  ['an unsupported namespace', { chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }],
  ['a zero chain id', { chain: 'eip155:0' }],
  ['a padded chain id', { chain: 'eip155:01' }],
  ['a malformed address', { addresses: { registry: '0x1234' } }],
  ['fractional decimals', { currency: { symbol: 'ETH', decimals: 1.5 } }],
  ['a plain HTTP RPC', { rpc: 'http://rpc.example' }],
  ['an RPC with a user name', { rpc: 'https://user@rpc.example' }],
  ['an explorer that is not a URL', { explorer: 'blockscout' }],
])('rejects %s', (_, override) => {
  expect(() => defineLedger({ ...local, ...override } as never)).toThrow(TypeError)
})

it('keeps public endpoints only when given', () => {
  expect('rpc' in defineLedger(local)).toBe(false)
  const withEndpoints = defineLedger({
    ...local,
    rpc: 'http://127.0.0.1:8545',
    explorer: 'https://explorer.example',
  })
  expect([withEndpoints.rpc, withEndpoints.explorer]).toEqual([
    'http://127.0.0.1:8545',
    'https://explorer.example',
  ])
})
