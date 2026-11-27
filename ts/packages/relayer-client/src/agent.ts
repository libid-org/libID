/// A limited session for an agent that tips handles from the user's wallet.
/// Below quorum the wallet checks its calls against the session's rules: the
/// wallet README's "Below quorum", in libID-contracts.

import { handleEscrowAbi, type SessionPolicy, sortAllowances } from '@libid/contracts'
import {
  type Address,
  concat,
  encodeAbiParameters,
  erc20Abi,
  type Hex,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  parseEther,
  size,
  slice,
  toFunctionSelector,
  zeroHash,
} from 'viem'

/// `NATIVE_TOKEN` of the contracts' `Constants.sol` (EIP-7528): the allowance
/// the value of a call is charged to.
export const NATIVE_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/// `agentPolicy`'s defaults: 0.01 ETH a day, for 30 days.
export const AGENT_DEFAULTS = {
  native: parseEther('0.01'),
  period: 86_400,
  lifetime: 30 * 86_400,
} as const

/// A `scopeRoot` leaf: calls to `target` with `selector` and at most `maxValue` wei.
export type ScopeLeaf = { target: Address; selector: Hex; maxValue: bigint }

export type AgentPolicyOptions = {
  escrow: Address
  /// Unix seconds; the session ends `AGENT_DEFAULTS.lifetime` after it.
  /// A `now` or `validUntil` at or above 1e11, a time in milliseconds, throws.
  now: number
  validUntil?: number
  /// ERC-20s the agent may approve the escrow for, each up to `amount` a
  /// period, in the token's units: 10 USDC is `10_000_000n`.
  /// A deposit spends the escrow's allowance uncharged: the wallet keeps none
  /// beyond what the agent approves.
  tokens?: readonly { token: Address; amount: bigint }[]
  /// Wei a period; also each deposit's most value.
  native?: bigint
  /// Seconds.
  period?: number
}

/// A non-admin policy, one signer, whose scope holds `HandleEscrow.deposit` and
/// `depositToHandle`, at most `native` wei each, and `approve` on each token,
/// at no value; and its scope, which proves the agent's calls.
export function agentPolicy(o: AgentPolicyOptions) {
  const { native = AGENT_DEFAULTS.native, period = AGENT_DEFAULTS.period, tokens = [] } = o
  const escrow = (name: 'deposit' | 'depositToHandle') => ({
    target: o.escrow,
    selector: selectorOf(handleEscrowAbi, name),
    maxValue: native,
  })
  const approve = selectorOf(erc20Abi, 'approve')
  const leaves: ScopeLeaf[] = [
    escrow('deposit'),
    escrow('depositToHandle'),
    ...tokens.map((t) => ({ target: t.token, selector: approve, maxValue: 0n })),
  ]
  const s = scope(leaves)
  const validUntil = o.validUntil ?? o.now + AGENT_DEFAULTS.lifetime
  for (const t of [o.now, validUntil]) {
    if (t >= 1e11) throw new Error(`${t} is not in Unix seconds`)
  }
  const allowances = [{ token: NATIVE_TOKEN, amount: native }, ...tokens].map((a) => ({
    token: a.token,
    amount: a.amount,
    period,
  }))
  const policy: SessionPolicy = {
    validAfter: 0,
    validUntil,
    admin: false,
    signers: 1,
    rules: sortAllowances({
      scopeRoot: s.root,
      domainsRoot: zeroHash,
      paymastersRoot: zeroHash,
      allowances,
    }),
  }
  return { policy, scope: s }
}

/// The OpenZeppelin `StandardMerkleTree` of `leaves`: its root, and
/// `calls(executions)`, an `Authorization.calls` entry per call. A call no leaf
/// allows throws.
export function scope(leaves: readonly ScopeLeaf[]) {
  const hashes = leaves.map(leafHash)
  const sorted = [...hashes].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
  const n = sorted.length
  const tree: Hex[] = new Array(Math.max(2 * n - 1, 0))
  sorted.forEach((h, i) => {
    tree[tree.length - 1 - i] = h
  })
  for (let i = tree.length - 1 - n; i >= 0; i--) tree[i] = pair(tree[2 * i + 1], tree[2 * i + 2])
  const prove = (leaf: ScopeLeaf) => {
    const proof: Hex[] = []
    for (let i = tree.indexOf(leafHash(leaf)); i > 0; i = (i - 1) >> 1) {
      proof.push(tree[i % 2 ? i + 1 : i - 1])
    }
    return { maxValue: leaf.maxValue, proof }
  }
  const calls = (executions: readonly { target: Address; callData: Hex }[]) =>
    executions.map((e) => {
      const selector = size(e.callData) < 4 ? '0x00000000' : slice(e.callData, 0, 4)
      const leaf = leaves.find((l) => isAddressEqual(l.target, e.target) && l.selector === selector)
      if (!leaf) throw new Error(`the scope allows no ${selector} on ${e.target}`)
      return prove(leaf)
    })
  return { root: tree[0] ?? zeroHash, calls }
}

const LEAF = parseAbiParameters('address, bytes4, uint256')

function leafHash(l: ScopeLeaf): Hex {
  return keccak256(keccak256(encodeAbiParameters(LEAF, [l.target, l.selector, l.maxValue])))
}

function pair(a: Hex, b: Hex): Hex {
  return keccak256(BigInt(a) < BigInt(b) ? concat([a, b]) : concat([b, a]))
}

function selectorOf(abi: readonly unknown[], name: string): Hex {
  const f = abi.find((x) => (x as { type: string; name?: string }).name === name)
  if (!f) throw new Error(`no ${name} in the ABI`)
  return toFunctionSelector(f as Parameters<typeof toFunctionSelector>[0])
}
