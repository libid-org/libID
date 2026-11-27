import { calls } from '@libid/contracts'
import { type Address, encodeFunctionData, erc20Abi, type Hex, zeroHash } from 'viem'
import { describe, expect, test } from 'vitest'

import { AGENT_DEFAULTS, agentPolicy, NATIVE_TOKEN, type ScopeLeaf, scope } from './agent.js'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const [ESCROW, USDC, DAI] = [a(0xe5c), a(1), a(2)]
const NOW = 1_700_000_000

describe('scope', () => {
  // `StandardMerkleTree.of(leaves, ['address', 'bytes4', 'uint256'])` of
  // @openzeppelin/merkle-tree 1.0.8: its root and each leaf's `getProof`.
  const leaves: ScopeLeaf[] = [
    { target: ESCROW, selector: '0x11223344', maxValue: 10n ** 16n },
    { target: ESCROW, selector: '0xaabbccdd', maxValue: 10n ** 16n },
    { target: a(1), selector: '0x095ea7b3', maxValue: 0n },
    { target: a(2), selector: '0x095ea7b3', maxValue: 0n },
    { target: a(3), selector: '0x095ea7b3', maxValue: 0n },
  ]
  const OZ_ROOT = '0x4b3e3a8059e9ec0a9cb7d8ccc3151ee5eaec8543147f16a1539aa0e74a950dac'
  const OZ_PROOFS: Hex[][] = [
    [
      '0xb48e2f98eac5e9d0bed21555224c0a875eba69bfe26cf50551777df06ee95350',
      '0xf51993a60869f1e46c794a681650ec1b4b1b0394c0324f4145dad6830014ccb5',
    ],
    [
      '0x709c1477d2ca20622825d889550d83776bcbac0036c2a3e4da354e54825c7fc0',
      '0xf51993a60869f1e46c794a681650ec1b4b1b0394c0324f4145dad6830014ccb5',
    ],
    [
      '0x50c55aaa2bdf40084d258d1b5b59e0dd2e408f62033cb2c1bbe49526f1cb7098',
      '0x24afb0ce294c4fde7ba2da50544a2f714fbad90d06c931ce2baa27dd6f0be220',
    ],
    [
      '0x21c78e34908a54b058470868e19bbaba9665c24172fdce8d57a2c459396c76ef',
      '0xf8564c55e6eb84266e22295c927c6ef6dce3cb4dde710d5fd07c6a96b8939adc',
      '0x24afb0ce294c4fde7ba2da50544a2f714fbad90d06c931ce2baa27dd6f0be220',
    ],
    [
      '0x481f7d8ae0a79f3f81a32372f5ed651d1203d52f9450488be5c52c0ecf59763c',
      '0xf8564c55e6eb84266e22295c927c6ef6dce3cb4dde710d5fd07c6a96b8939adc',
      '0x24afb0ce294c4fde7ba2da50544a2f714fbad90d06c931ce2baa27dd6f0be220',
    ],
  ]

  test("matches OpenZeppelin's root and proofs", () => {
    const s = scope(leaves)
    expect(s.root).toBe(OZ_ROOT)
    const executions = leaves.map((l) => ({ target: l.target, callData: `${l.selector}00` as Hex }))
    expect(s.calls(executions)).toEqual(
      leaves.map((l, i) => ({ maxValue: l.maxValue, proof: OZ_PROOFS[i] })),
    )
  })

  test('no leaf is root 0; a call no leaf allows throws', () => {
    expect(scope([]).root).toBe(zeroHash)
    const short = { target: ESCROW, callData: '0x' as Hex }
    expect(() => scope(leaves).calls([short])).toThrow('0x00000000')
  })
})

test('agentPolicy: deposits and approvals within the allowances, for 30 days', () => {
  const tokens = [
    { token: USDC, amount: 10_000_000n },
    { token: DAI, amount: 10n ** 19n },
  ]
  const { policy, scope: s } = agentPolicy({ escrow: ESCROW, now: NOW, tokens })
  const period = AGENT_DEFAULTS.period
  expect(policy).toEqual({
    validAfter: 0,
    validUntil: NOW + 30 * 86_400,
    admin: false,
    signers: 1,
    rules: {
      scopeRoot: s.root,
      domainsRoot: zeroHash,
      paymastersRoot: zeroHash,
      allowances: [
        { token: USDC, amount: 10_000_000n, period },
        { token: DAI, amount: 10n ** 19n, period },
        { token: NATIVE_TOKEN, amount: 10n ** 16n, period },
      ],
    },
  })
  const node = `0x${'11'.repeat(32)}` as Hex
  const deposit = calls.handleEscrow.deposit(ESCROW, 1n, node, node, NATIVE_TOKEN, 1n)
  const tip = calls.handleEscrow.depositToHandle(ESCROW, 1n, node, 'alice', NATIVE_TOKEN, 1n)
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [ESCROW, 1n],
  })
  const proved = s.calls([
    { target: ESCROW, callData: deposit.data },
    { target: ESCROW, callData: tip.data },
    { target: DAI, callData: approve },
  ])
  expect(proved.map((c) => c.maxValue)).toEqual([10n ** 16n, 10n ** 16n, 0n])
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [ESCROW, 1n],
  })
  expect(() => s.calls([{ target: USDC, callData: transfer }])).toThrow()
  expect(() => s.calls([{ target: a(9), callData: approve }])).toThrow()

  const until = agentPolicy({ escrow: ESCROW, now: NOW, validUntil: NOW + 60 }).policy
  expect(until.validUntil).toBe(NOW + 60)
})

test('agentPolicy refuses times in milliseconds', () => {
  expect(() => agentPolicy({ escrow: ESCROW, now: NOW * 1000 })).toThrow('not in Unix seconds')
  const late = { escrow: ESCROW, now: NOW, validUntil: NOW * 1000 }
  expect(() => agentPolicy(late)).toThrow('not in Unix seconds')
  expect(
    agentPolicy({ escrow: ESCROW, now: 1e11 - 1, validUntil: 1e11 - 1 }).policy.validUntil,
  ).toBe(1e11 - 1)
})
