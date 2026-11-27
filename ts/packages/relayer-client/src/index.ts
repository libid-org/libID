/// Onboard a libID web wallet through the relayer: one relayed transaction
/// creates the wallet, links the identity with the genesis key as admin, binds
/// the identity privately, claims the handle's escrow into the wallet and
/// repays the relayer from it. Sign a new key in to an existing wallet the same
/// way, repaid from the wallet's ETH. Wire format: the README of
/// libid-org/relayer, "HTTP API".

import {
  authorizedData,
  bindOperation,
  type Call,
  calls,
  DIRECT_NONCE_KEY,
  encodeOperationList,
  executeDigest,
  handleEscrowAbi,
  LINK_IDENTITY_DOMAIN,
  type SessionPolicy,
  walletFactoryAbi,
  walletRegistryAbi,
  walletSalt,
  walletTransactionData,
  webWalletAbi,
} from '@libid/contracts'
import {
  type Address,
  encodeAbiParameters,
  erc20Abi,
  type Hex,
  isAddressEqual,
  keccak256,
  type PublicClient,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import {
  ClaimTooSmall,
  escrowHoldings,
  type Holding,
  quoteSwap,
  SWAP_ROUTES,
  type SwapPlan,
  type SwapRoute,
  shortfall,
  swapCalls,
  withSlippage,
} from './swap.js'

export * from './agent.js'
export * from './swap.js'

/// `GET /v1/config`, the fields the client reads.
export type RelayerConfig = {
  chainId: number
  relayer: Address
  factory: Address
  /// The wallets' `WalletRegistry`.
  registry: Address
  inclusionWindowSeconds: number
  quoteValiditySeconds: number
  /// How long a request may wait queued: its deadline may run this much later.
  queueWaitSeconds: number
}

/// `POST /v1/quote`: sign `callGas` and a refund of at least the batch's value
/// plus `minRefund`, for a send at `gasLimit`, before `validUntil` (Unix seconds).
export type Quote = {
  /// The least gas each call gets, one floor per call.
  callGas: number[]
  gasLimit: number
  maxFeePerGas: bigint
  l1FeeBound: bigint
  minRefund: bigint
  validUntil: number
}

/// A refusal: the HTTP status and the relayer's `{name, message, args}`.
export class RelayerError extends Error {
  constructor(
    readonly status: number,
    override readonly name: string,
    message: string,
    readonly args: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/// The genesis key, wherever it lives: `key` is its session key (an ECDSA
/// key's 20-byte address), `sign` returns its 65-byte signature of `digest`.
export type Signer = { key: Hex; sign(digest: Hex): Promise<Hex> }

/// What the ceremony's proof commits under `OPERATIONS_DOMAIN`: bind the
/// identity to `wallet`, and link it there with `key` under `policy`.
export function onboardingTransactionData(p: {
  chainId: number | bigint
  wallet: Address
  key: Hex
  policy: SessionPolicy
}): Hex {
  const link = walletTransactionData(p.chainId, p.wallet, p.wallet, p.key, p.policy)
  return encodeOperationList([
    bindOperation(p.wallet),
    { domain: LINK_IDENTITY_DOMAIN, data: link },
  ])
}

/// The wallet `factory` creates for the identity at `salt`.
export function walletAddress(
  client: PublicClient,
  factory: Address,
  platformId: Hex,
  idNode: Hex,
  salt = 0n,
): Promise<Address> {
  return client.readContract({
    address: factory,
    abi: walletFactoryAbi,
    functionName: 'walletAddress',
    args: [platformId, idNode, salt],
  })
}

export type Execution = { target: Address; value: bigint; callData: Hex }

const EXECUTIONS = parseAbiParameters('(address target, uint256 value, bytes callData)[]')

/// `executionCalldata` of an `AUTHORIZED_MODE` batch: `abi.encode(Execution[])`.
export function encodeExecutions(executions: readonly Execution[]): Hex {
  return encodeAbiParameters(EXECUTIONS, [executions])
}

export type Onboarding = {
  relayerUrl: string
  client: PublicClient
  proof: { platformId: Hex; verifierVersion: number; payload: Hex }
  idNode: Hex
  salt?: bigint
  signer: Signer
  policy: SessionPolicy
  identityRegistry: Address
  escrow: Address
  handleNode: Hex
  /// A second key the batch adds under `policy`, for the genesis identity,
  /// active from the next second.
  session?: { key: Hex; policy: SessionPolicy }
  /// Approved tokens by chain id; `SWAP_ROUTES` by default.
  routes?: Record<number, readonly SwapRoute[]>
  /// The most a swap may pay over its quote, in basis points; 100 by default.
  slippageBps?: number
}

/// Link, add `session` when set, bind privately, claim `tokens` into the
/// wallet, swap when `swap` is set, then repay `refund` to the relayer.
export function onboardingBatch(
  o: Pick<
    Onboarding,
    'proof' | 'idNode' | 'policy' | 'identityRegistry' | 'escrow' | 'handleNode' | 'session'
  >,
  b: { wallet: Address; fee: bigint; relayer: Address; tokens: readonly Address[] },
  refund: bigint,
  deadline: number,
  swap?: SwapPlan,
): Execution[] {
  const { platformId, verifierVersion, payload } = o.proof
  const { wallet } = b
  const swaps = swap ? swapCalls(swap, wallet, deadline) : []
  const identity = identityOf(platformId, o.idNode)
  const session = o.session
    ? [calls.webWallet.addSession(wallet, identity, o.session.key, o.session.policy)]
    : []
  return [
    calls.webWallet.linkIdentity(wallet, b.fee, platformId, verifierVersion, payload, o.policy),
    ...session,
    calls.identityRegistry.bindPrivately(
      o.identityRegistry,
      0n,
      platformId,
      verifierVersion,
      payload,
      0n,
      zeroAddress,
    ),
    calls.handleEscrow.claim(o.escrow, o.handleNode, b.tokens, wallet),
    ...swaps,
    { to: b.relayer, value: refund, data: '0x' as Hex },
  ].map(execution)
}

/// The wallet's id of a linked identity: `identityOf` of `WalletStorage.sol`.
function identityOf(platformId: Hex, idNode: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [platformId, idNode]),
  )
}

function execution(c: Call): Execution {
  return { target: c.to, value: c.value ?? 0n, callData: c.data }
}

/// `GET /v1/config`: among others, the factory `walletAddress` reads.
export async function relayerConfig(relayerUrl: string): Promise<RelayerConfig> {
  return (await relayerHttp(relayerUrl)('GET', '/v1/config')) as RelayerConfig
}

/// A relayed onboarding: the request, the wallet, the quote it was signed
/// under, and what the refund is made of.
export type Onboarded = {
  id: Hex
  wallet: Address
  /// The genesis session key, admin once the onboarding lands.
  key: Hex
  /// `Onboarding.session`'s key.
  session?: Hex
  quote: Quote
  /// The batch's deadline, in Unix seconds: until then it may still land.
  deadline: number
  /// `HandleEscrow.NATIVE`, the chain's coin among `tokens`.
  native: Address
  /// The tokens the batch claims into the wallet.
  tokens: Address[]
  linkFee: bigint
  gasRefund: bigint
  /// Each swap's tokens in, and the least ETH it must return.
  swapped: { token: Address; amountIn: bigint; ethOutMin: bigint }[]
}

/// Quote, sign and relay the onboarding. Returns the request's id, the wallet,
/// and the quote it was signed under; `waitFor` follows it on chain. Throws
/// `ClaimTooSmall` when the holdings cannot repay the relayer.
export async function onboard(o: Onboarding): Promise<Onboarded> {
  const http = relayerHttp(o.relayerUrl)
  const { config, chainId } = await sameChain(o)
  const { platformId, verifierVersion, payload } = o.proof
  const salt = o.salt ?? 0n
  const native = { address: o.escrow, abi: handleEscrowAbi, functionName: 'NATIVE' } as const
  const [wallet, [, version], fee, block, coin] = await Promise.all([
    walletAddress(o.client, config.factory, platformId, o.idNode, salt),
    o.client.readContract({
      address: config.factory,
      abi: walletFactoryAbi,
      functionName: 'latest',
    }),
    o.client.readContract({
      address: config.registry,
      abi: walletRegistryAbi,
      functionName: 'quoteFor',
      args: [platformId, verifierVersion, payload],
    }),
    o.client.getBlock(),
    o.client.readContract(native),
  ])
  const routes = (o.routes ?? SWAP_ROUTES)[chainId] ?? []
  // From the chain: an indexer misses the deposits it has not indexed.
  const candidates = [coin, ...routes.map((r) => r.token)]
  const holdings = await escrowHoldings(o.client, o.escrow, candidates)(o.handleNode, chainId)
  const heldOf = (token: Address) =>
    holdings.find((h) => isAddressEqual(h.token, token) && h.amount > 0n)?.amount ?? 0n
  const eth = heldOf(coin)
  // Every approved token held is claimed; the one worth the most ETH to the
  // quoter pays the swap.
  const valued = routes
    .map((route) => ({ route, held: heldOf(route.token) }))
    .filter((r) => r.held > 0n)
    .map(async (r) => ({ ...r, worth: await quoteSwap(o.client, r.route, { in: r.held }) }))
  const approved = await Promise.all(valued)
  const best = approved.filter((r) => r.worth > 0n).sort((x, y) => (y.worth > x.worth ? 1 : -1))[0]
  const claimed = [...(eth > 0n ? [coin] : []), ...approved.map((r) => r.route.token)]
  if (claimed.length === 0) throw new ClaimTooSmall(0n, fee)
  const b = { wallet, fee, relayer: config.relayer, tokens: claimed }

  const at = Number(block.timestamp)
  // A wallet not yet created signs at nonce 0 under the domain salt of epoch 0.
  const authorize = async (
    refund: bigint,
    callGas: readonly number[] | undefined,
    deadline: number,
    signer: Signer,
    swap?: SwapPlan,
  ) => {
    const batch = onboardingBatch(o, b, refund, deadline, swap)
    const message = { value: fee, at, nonce: 0n, deadline, callGas }
    const domain = { chainId, wallet, version, salt: walletSalt(zeroHash, 0) }
    return authorized(batch, message, domain, o.signer.key, signer)
  }
  const create = { platformId, idNode: o.idNode, salt: salt.toString() }
  // The draft: well-formed, at zero floors, signed by a throwaway key under the real
  // key bytes.
  const quoted = async (swap?: SwapPlan) => {
    const data = await authorize(0n, undefined, at + 3600, throwaway(), swap)
    return parseQuote(await http('POST', '/v1/quote', { wallet, create, data }))
  }
  // The swap of the best token that returns at least what the claimed ETH lacks.
  const planned = async (refund: bigint): Promise<SwapPlan | undefined> => {
    const minOut = shortfall(refund, eth)
    if (minOut === 0n) return undefined
    if (!best) throw new ClaimTooSmall(eth, refund)
    const quotedIn = await quoteSwap(o.client, best.route, { out: minOut })
    const amountIn = withSlippage(quotedIn, o.slippageBps ?? 100)
    if (amountIn > best.held) throw new ClaimTooSmall(eth + best.worth, refund)
    return { route: best.route, amountIn, minOut }
  }
  // A quote, and the swap its refund needs. Quoted without a swap first; a
  // shortfall drafts the swap and quotes again, so only a needed swap is priced.
  const priced = async (drafted?: SwapPlan) => {
    let quote = await quoted(drafted)
    let swap = await planned(fee + quote.minRefund)
    if (swap && !drafted) {
      quote = await quoted(swap)
      swap = await planned(fee + quote.minRefund)
    }
    return { quote, swap }
  }
  let { quote, swap } = await priced()
  for (let retried = false; ; retried = true) {
    const refund = fee + quote.minRefund
    const deadline = quote.validUntil + config.queueWaitSeconds + config.inclusionWindowSeconds
    const data = await authorize(refund, quote.callGas, deadline, o.signer, swap)
    try {
      const body = { wallet, create, data, gasLimit: quote.gasLimit }
      const { id } = (await posted(() => http('POST', '/v1/relay', body))) as { id: Hex }
      const swapped = swap
        ? [{ token: swap.route.token, amountIn: swap.amountIn, ethOutMin: swap.minOut }]
        : []
      const parts = { linkFee: fee, gasRefund: quote.minRefund, swapped }
      const keys = { key: o.signer.key, session: o.session?.key }
      const onboarded = { id, wallet, ...keys, quote, deadline, native: coin }
      return { ...onboarded, tokens: claimed, ...parts }
    } catch (e) {
      if (retried || !(e instanceof RelayerError) || e.name !== 'GasLimitTooLow') throw e
      ;({ quote, swap } = await priced(swap))
    }
  }
}

/// What a login's proof commits under `ADD_SESSION_DOMAIN`, not an operation
/// list: add `key` to `wallet` under `policy`, sent by the wallet's own batch.
export function signInTransactionData(p: {
  chainId: number | bigint
  wallet: Address
  key: Hex
  policy: SessionPolicy
}): Hex {
  return walletTransactionData(p.chainId, p.wallet, p.wallet, p.key, p.policy)
}

export type SignIn = {
  relayerUrl: string
  client: PublicClient
  wallet: Address
  proof: { platformId: Hex; verifierVersion: number; payload: Hex }
  /// The new key, the batch's only signer.
  signer: Signer
  policy: SessionPolicy
}

/// The wallet's login of the new key at the head, so the key signs the batch,
/// then `refund` to the relayer.
export function signInBatch(
  o: Pick<SignIn, 'proof' | 'policy'>,
  b: { wallet: Address; fee: bigint; relayer: Address },
  refund: bigint,
): Execution[] {
  const { platformId, verifierVersion, payload } = o.proof
  return [
    calls.webWallet.addSessionByLogin(
      b.wallet,
      b.fee,
      platformId,
      verifierVersion,
      payload,
      o.policy,
    ),
    { to: b.relayer, value: refund, data: '0x' as Hex },
  ].map(execution)
}

/// The wallet's ETH cannot repay the relayer: `held` and `required` in wei.
export class BalanceTooLow extends Error {
  override readonly name = 'BalanceTooLow'
  constructor(
    readonly held: bigint,
    readonly required: bigint,
  ) {
    super(`the wallet holds ${held} wei, the refund needs ${required}`)
  }
}

/// A relayed sign-in: the request, the quote it was signed under, and the
/// refund's parts, `loginFee` and `gasRefund`.
export type SignedIn = {
  id: Hex
  wallet: Address
  /// The new session key.
  key: Hex
  quote: Quote
  /// The batch's deadline, in Unix seconds: until then it may still land.
  deadline: number
  loginFee: bigint
  gasRefund: bigint
}

/// Quote, sign with the new key alone and relay the sign-in; `waitFor` with
/// `signedIn` follows it. Throws `BalanceTooLow`, before relaying, when the
/// wallet's ETH is under the refund.
export async function signIn(o: SignIn): Promise<SignedIn> {
  const http = relayerHttp(o.relayerUrl)
  const { config, chainId } = await sameChain(o)
  const { wallet } = o
  const { platformId, verifierVersion, payload } = o.proof
  const read = { address: wallet, abi: webWalletAbi } as const
  const [fee, block, [, , version, , , salt], nonce, held] = await Promise.all([
    o.client.readContract({
      address: config.registry,
      abi: walletRegistryAbi,
      functionName: 'quoteFor',
      args: [platformId, verifierVersion, payload],
    }),
    o.client.getBlock(),
    o.client.readContract({ ...read, functionName: 'eip712Domain' }),
    o.client.readContract({ ...read, functionName: 'getNonce', args: [DIRECT_NONCE_KEY] }),
    o.client.getBalance({ address: wallet }),
  ])
  const at = Number(block.timestamp)
  const domain = { chainId, wallet, version: BigInt(version), salt }
  const b = { wallet, fee, relayer: config.relayer }
  const authorize = (
    refund: bigint,
    callGas: readonly number[] | undefined,
    deadline: number,
    signer: Signer,
  ) => {
    const message = { value: fee, at, nonce, deadline, callGas }
    return authorized(signInBatch(o, b, refund), message, domain, o.signer.key, signer)
  }
  const quoted = async () => {
    const data = await authorize(0n, undefined, at + 3600, throwaway())
    return parseQuote(await http('POST', '/v1/quote', { wallet, data }))
  }
  let quote = await quoted()
  for (let retried = false; ; retried = true) {
    const refund = fee + quote.minRefund
    if (held < refund) throw new BalanceTooLow(held, refund)
    const deadline = quote.validUntil + config.queueWaitSeconds + config.inclusionWindowSeconds
    const data = await authorize(refund, quote.callGas, deadline, o.signer)
    try {
      const body = { wallet, data, gasLimit: quote.gasLimit }
      const { id } = (await posted(() => http('POST', '/v1/relay', body))) as { id: Hex }
      const parts = { loginFee: fee, gasRefund: quote.minRefund }
      return { id, wallet, key: o.signer.key, quote, deadline, ...parts }
    } catch (e) {
      if (retried || !(e instanceof RelayerError) || e.name !== 'GasLimitTooLow') throw e
      quote = await quoted()
    }
  }
}

/// The relayer's config, once the client is on its chain.
async function sameChain(o: { relayerUrl: string; client: PublicClient }) {
  const config = await relayerConfig(o.relayerUrl)
  const chainId = await o.client.getChainId()
  if (chainId !== config.chainId) {
    throw new Error(`the client is on chain ${chainId}, the relayer on ${config.chainId}`)
  }
  return { config, chainId }
}

/// `execute(AUTHORIZED_MODE, data)`'s data for `batch`, `signer` signing as
/// `key`; without `callGas`, at a zero floor per call.
async function authorized(
  batch: Execution[],
  m: { value: bigint; at: number; nonce: bigint; deadline: number; callGas?: readonly number[] },
  d: { chainId: number; wallet: Address; version: bigint; salt: Hex },
  key: Hex,
  signer: Signer,
): Promise<Hex> {
  const message = {
    ...m,
    executionCalldata: encodeExecutions(batch),
    callGas: m.callGas ? m.callGas.map(BigInt) : batch.map(() => 0n),
  }
  const digest = executeDigest(message, d.chainId, d.wallet, d.version, d.salt)
  const signatures = [{ key, signature: await signer.sign(digest) }]
  return authorizedData(message, { signatures, calls: [], domainProof: [], paymasterProof: [] })
}

type WaitOptions = {
  intervalMs?: number
  timeoutMs?: number
  client?: PublicClient
  onboarded?: Pick<Onboarded, 'wallet' | 'key' | 'session' | 'native' | 'tokens' | 'deadline'>
  signedIn?: Pick<SignedIn, 'wallet' | 'key' | 'deadline'>
}

/// `GET /v1/relay/{id}` every `intervalMs` until the request settles, through
/// network errors, `408` and `5xx` answers. An inclusion that reverted, a
/// failure and a cancellation throw. With `client` and an onboarding, also what
/// the new wallet holds of its claimed tokens at the inclusion block: what it
/// received, net of the swap and the refund.
/// A request the relayer dropped, past its receipt's lag, is `UnknownRequest`:
/// with `client` and an onboarding the chain answers instead, settled once the
/// wallet has code and the genesis key is its admin session, at the latest
/// block, with no hashes; otherwise it throws `RequestDropped` at once.
/// A cancelled batch may still land, sent by anyone, until its deadline: with
/// `client` and an onboarding the chain answers once a block is past it;
/// otherwise `Cancelled` throws at once, its `args.deadline` the onboarding's.
/// With `signedIn` in place of an onboarding, the chain settles it once the new
/// key has a login's session, and `received` is empty.
export async function waitFor(
  relayerUrl: string,
  id: Hex,
  { intervalMs = 500, timeoutMs = 120_000, client, onboarded, signedIn }: WaitOptions = {},
): Promise<{ txHashes: Hex[]; blockNumber: number; received: Holding[] }> {
  const http = relayerHttp(relayerUrl)
  const landing = onboarded ?? signedIn
  const landed = async (): Promise<RelayStatus | undefined> => {
    if (!client || !landing) return undefined
    const extra: Settles[] = onboarded?.session
      ? [[onboarded.session, (s) => s.identity !== zeroHash]]
      : []
    const sessions: Settles[] = onboarded
      ? [[onboarded.key, (s) => s.admin], ...extra]
      : [[landing.key, (s) => s.byProof]]
    const at = await landedAt(client, landing.wallet, sessions)
    return at === undefined ? undefined : { status: 'included', txHashes: [], blockNumber: at }
  }
  const pause = () => new Promise((r) => setTimeout(r, intervalMs))
  for (const end = Date.now() + timeoutMs; Date.now() < end; ) {
    const s = await (http('GET', `/v1/relay/${id}`) as Promise<RelayStatus>).catch(
      async (e): Promise<RelayStatus | undefined> => {
        if (transient(e)) return undefined
        const unknown = e instanceof RelayerError && e.name === 'UnknownRequest'
        if (!unknown || !client || !landing) throw e
        const settled = await landed()
        if (!settled) throw dropped(id)
        return settled
      },
    )
    if (!s) {
      await pause()
      continue
    }
    if (s.status === 'cancelled') {
      const deadline = landing?.deadline
      const cancelled = () =>
        new RelayerError(200, 'Cancelled', 'the relayer cancelled it', { deadline })
      if (!client || deadline === undefined) throw cancelled()
      while (Number((await client.getBlock()).timestamp) <= deadline) {
        if (Date.now() >= end) throw timedOut(id, timeoutMs)
        await pause()
      }
      const settled = await landed()
      if (!settled) throw cancelled()
      return included(settled)
    }
    if (s.status === 'included' && !s.reverted) return included(s)
    if (s.status === 'included') throw new RelayerError(200, 'Reverted', 'the batch reverted')
    if (s.status === 'failed') throw refusal(200, s.error)
    await pause()
  }
  throw timedOut(id, timeoutMs)

  async function included(s: RelayStatus) {
    const blockNumber = s.blockNumber as number
    const received =
      client && onboarded ? await balances(client, onboarded, BigInt(blockNumber)) : []
    return { txHashes: s.txHashes, blockNumber, received }
  }
}

function timedOut(id: Hex, timeoutMs: number): Error {
  return new Error(`request ${id} did not settle in ${timeoutMs} ms`)
}

/// A network error, or a `408` or `5xx` answer: the same request may succeed again.
function transient(e: unknown): boolean {
  if (!(e instanceof RelayerError)) return e instanceof TypeError
  return e.status === 408 || e.status >= 500
}

/// How often, and how far apart, `onboard` posts the same relay again.
const POSTS = 3
const REPOST_MS = 1_000

/// `post` again while it fails [`transient`]ly, at most `POSTS` times in all.
async function posted<T>(post: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await post()
    } catch (e) {
      if (n >= POSTS || !transient(e)) throw e
      await new Promise((r) => setTimeout(r, REPOST_MS))
    }
  }
}

type Session = { identity: Hex; admin: boolean; byProof: boolean }
/// A key, and when its session counts as landed.
type Settles = [Hex, (session: Session) => boolean]

/// The latest block once `wallet` has code and each key's session settles.
async function landedAt(
  client: PublicClient,
  wallet: Address,
  sessions: Settles[],
): Promise<number | undefined> {
  const blockNumber = await client.getBlockNumber()
  const code = await client.getCode({ address: wallet, blockNumber })
  if (!code || code === '0x') return undefined
  const read = { address: wallet, abi: webWalletAbi, functionName: 'sessionOf' } as const
  const of = (key: Hex) => client.readContract({ ...read, args: [key], blockNumber })
  const settled = await Promise.all(sessions.map(async ([key, settles]) => settles(await of(key))))
  return settled.every(Boolean) ? Number(blockNumber) : undefined
}

/// `wallet`'s balance of ETH (`native`) and of each of `tokens` at `blockNumber`.
function balances(
  client: PublicClient,
  { wallet, native, tokens }: Pick<Onboarded, 'wallet' | 'native' | 'tokens'>,
  blockNumber: bigint,
): Promise<Holding[]> {
  const of = (token: Address) =>
    isAddressEqual(token, native)
      ? client.getBalance({ address: wallet, blockNumber })
      : client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet],
          blockNumber,
        })
  const all = [native, ...tokens.filter((t) => !isAddressEqual(t, native))]
  return Promise.all(all.map(async (token) => ({ token, amount: await of(token) })))
}

type RelayStatus = {
  status: 'queued' | 'sent' | 'included' | 'cancelled' | 'failed'
  txHashes: Hex[]
  blockNumber?: number
  reverted?: boolean
  error?: unknown
}

/// A request the relayer no longer holds, its wallet not onboarded.
function dropped(id: Hex): RelayerError {
  const why = 'it failed and a later request of the identity replaced it, or it was dropped'
  return new RelayerError(
    404,
    'RequestDropped',
    `request ${id} is gone and the wallet is not onboarded: ${why}`,
  )
}

function throwaway(): Signer {
  const account = privateKeyToAccount(generatePrivateKey())
  return { key: account.address, sign: (hash) => account.sign({ hash }) }
}

function parseQuote(q: unknown): Quote {
  const r = q as Record<string, string | number> & { callGas: number[] }
  return {
    callGas: r.callGas.map(Number),
    gasLimit: Number(r.gasLimit),
    maxFeePerGas: BigInt(r.maxFeePerGas),
    l1FeeBound: BigInt(r.l1FeeBound),
    minRefund: BigInt(r.minRefund),
    validUntil: Number(r.validUntil),
  }
}

/// A refusal body's `{name, message, args?}` as a `RelayerError`.
export function refusal(status: number, error: unknown): RelayerError {
  const e = (error ?? {}) as { name?: string; message?: string; args?: Record<string, unknown> }
  return new RelayerError(status, e.name ?? 'Unknown', e.message ?? `HTTP ${status}`, e.args)
}

/// JSON over `fetch`; a non-2xx answer throws its `RelayerError`.
function relayerHttp(base: string) {
  return async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const json =
      text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : {}
    if (!response.ok) throw refusal(response.status, json.error ?? { message: text || undefined })
    return json
  }
}
