# @libid/relayer-client

Onboards a libID web wallet through the relayer in one transaction, and signs
a new key in to it the same way (see "Sign in"). The onboarding
transaction creates the wallet, links the identity with a genesis key as
admin, binds the identity privately in the `IdentityRegistry`, claims the
handle's `HandleEscrow` funds into the wallet, swaps an approved token for ETH
when the claimed ETH falls short, and repays the relayer in ETH. The wallet
starts with no ETH; the user pays nothing up front.

## Use

Two steps, because the ceremony's proof commits the wallet and the key.

```ts
import { idNode } from '@libid/contracts'
import {
  onboard,
  onboardingTransactionData,
  relayerConfig,
  waitFor,
  walletAddress,
} from '@libid/relayer-client'

// 1. Before the ceremony: what the proof commits.
const config = await relayerConfig(relayerUrl)
const node = idNode('x', xUserId)
const wallet = await walletAddress(client, config.factory, platformId, node)
const transactionData = onboardingTransactionData({ chainId: config.chainId, wallet, key, policy })
// ... run the ceremony with `transactionData` under OPERATIONS_DOMAIN ...

// 2. After it: quote, sign, relay.
const onboarded = await onboard({
  relayerUrl,
  client,
  proof: { platformId, verifierVersion, payload },
  idNode: node,
  signer: { key, sign: (digest) => kms.sign(digest) },
  policy,
  identityRegistry,
  escrow,
  handleNode,
})
const { received } = await waitFor(relayerUrl, onboarded.id, { client, onboarded })
```

`client` is a viem `PublicClient` on the relayer's chain. The signer holds the
genesis key: `key` is its session key, 20 bytes for ECDSA, and `sign` returns
a 65-byte signature of the digest. The client never sees a private key.

The genesis key is a throwaway: generate it in memory, keep it until the
onboarding is included (the proof commits it, and a failed relay needs it
again), then drop it. It is never revoked; later access is by X login
(`addSessionByLogin`), and at quorum 1 a login session acts fully.

`session: {key, policy}` adds a second key in the same batch, right after
the link: the wallet's `addSession` for the genesis identity, active from the
next second. A server that holds both keys keeps the second, under a limited
policy, and drops the genesis key once the onboarding lands. `onboard`
returns its key as `session`; `waitFor` with the onboarding settles a
dropped request only once that session exists too.

`handleNode` is an input: the ceremony's result names the handle
(`handleNode('x', handle)` from `@libid/contracts`). Reading it from the
proof would take each payload format's layout or a second `verify` call.

`onboard`:

1. Reads the relayer's config, the link fee (`WalletRegistry.quoteFor`), the
   factory's latest release, the chain's time, and what the escrow holds for
   the handle of the chain's coin and each approved token
   (`HandleEscrow.escrowed`).
2. Claims the escrow's ETH and every approved token held; the one the quoter
   values highest pays the swap. With none of them, it throws `ClaimTooSmall`.
   Tokens outside the table stay in the escrow.
3. Drafts the batch at zero call gas floors and no refund, signed by a
   throwaway key, and quotes it. When the claimed ETH is under the refund `R`
   (the link fee plus `minRefund`), it drafts the swap that covers the
   difference and quotes again, so a swap is priced only when it runs.
4. Signs the quoted floors (`callGas`, one per call) and `R`, valid until
   `validUntil` plus the queue's wait and the inclusion window. The swap sells the token amount the quoter asks for the
   shortfall, plus `slippageBps` (100 by default), for at least the shortfall
   in ETH. It approves exactly that amount, which the swap spends whole, so no
   allowance is left. The surplus ETH stays in the wallet. When the token
   cannot cover the shortfall, it throws `ClaimTooSmall {held, required}`,
   both in wei.
5. Relays it, posting the same body again, up to three times in all, after a
   network error or a `408` or `5xx` answer: a lost answer leaves no request
   without its id. On `GasLimitTooLow` it quotes and signs once more.

It returns the request `id`, the `wallet`, the genesis session `key`, the
`quote`, the batch's `deadline` (Unix seconds), the claimed `tokens` (`native` is the chain's coin), and the refund's
parts: `linkFee`, `gasRefund` (`minRefund`) and `swapped`
(`{token, amountIn, ethOutMin}`). With `client`
and the onboarding, `waitFor` also returns `received`: what the new wallet
holds of ETH and of each claimed token at the inclusion block, net of the
swap and the refund. The relayer drops a paid request `receipt_lag_blocks`
after its receipt: polled later, the id is `UnknownRequest`, and `waitFor`
with `client` and the onboarding reads the chain instead, settled once the
wallet has code and `key` is its admin session (at the latest block, with no
`txHashes`). While it is not, `waitFor` throws `RequestDropped` at once: the
request failed and a later one of the identity replaced it, or it was
dropped. Relay again. `waitFor` polls through network errors and `408` or
`5xx` answers until its timeout. A cancelled batch may still land, sent by
anyone, until its deadline: with `client` and the onboarding, `waitFor`
waits for a block past it, then settles from the chain as above or throws
`Cancelled`; without them it throws `Cancelled` at once, with
`args.deadline`.

A refusal throws `RelayerError` with the HTTP `status` and the relayer's
`name`, `message` and `args`; `IdentityBusy` carries the request in flight as
`args.id`. `DeadlineTooFar` means the batch was signed to expire after
`args.max`, which `onboard`'s deadline, `validUntil` plus the config's
`queueWaitSeconds` and `inclusionWindowSeconds`, does not. A quote refused
as `LinkSessionRefused` means the proof is not this wallet's genesis
identity. `SignInMissing` means the batch carries no sign-in, which the
relayer requires; `onboard`'s link of a new wallet is one. `waitFor` throws on a reverted inclusion, a
failure or a cancellation.

Assumption: the claim page knows the X user id before the ceremony (from the
Grok mention), so it can compute `idNode` and the wallet address that the
proof must commit.

## Sign in

A new key signs in to an existing wallet in one relayed transaction, repaid
from the wallet's own ETH.

```ts
// 1. Before the ceremony: what the login proof commits, under ADD_SESSION_DOMAIN.
const transactionData = signInTransactionData({ chainId: config.chainId, wallet, key, policy })

// 2. After it.
const signedIn = await signIn({
  relayerUrl,
  client,
  wallet,
  proof: { platformId, verifierVersion, payload },
  signer: { key, sign: (digest) => kms.sign(digest) },
  policy,
})
await waitFor(relayerUrl, signedIn.id, { client, signedIn })
```

The batch is `signInBatch`: the wallet's `addSessionByLogin` of the new key at
its head, then the refund, the login fee plus `minRefund`. A login at the head
of the wallet's own batch is active in that block, so the new key alone signs
the batch, under the wallet's `eip712Domain()` and nonce. Quorum counts the
admin platforms among the signers, so the new key reaches it alone only under
an admin policy on a wallet of threshold 1; a below-quorum batch is never
relayed. `signIn` throws `BalanceTooLow {held, required}`, in wei,
before relaying when the wallet's ETH is under the refund. It posts again and
quotes again as `onboard` does, and returns the request `id`, `key`, `quote`,
`deadline`, `loginFee` and `gasRefund`. Once the request is dropped, `waitFor`
with `signedIn` settles when the key has a login's session.
The relayer holds one request per identity: right after the wallet's
onboarding or an earlier sign-in, `signIn` is `IdentityBusy` until that
request's row is dropped, `receipt_lag_blocks` after its receipt.

### Holdings

`onboard` reads the escrow from the chain with
`escrowHoldings(client, escrow, tokens)`. `indexerHoldings(url)` reads the
usernames-indexer's `GET /v1/escrow/node/{node}?chain=`, every page, for a
page that lists what a handle holds; it lags the chain and misses the
deposits it has not indexed.

### Approved tokens

`SWAP_ROUTES` lists them by chain id; `routes` replaces the table. A swap is
an `approve` of the router and SwapRouter02's `multicall(deadline, …)` of
`exactInputSingle` (to the router) and `unwrapWETH9(minOut, wallet)`.

All routes on Base (8453) use Uniswap v3's SwapRouter02
`0x2626664c2603336E57B271c5C0b26F421741e481`, QuoterV2
`0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` and WETH
`0x4200000000000000000000000000000000000006`.

| Token                                                   | Address                                      | Pool fee |
| ------------------------------------------------------- | -------------------------------------------- | -------- |
| USDC, issued by Circle                                  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 0.05%    |
| USDT, bridged from Ethereum by the Base standard bridge | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 0.05%    |

Tether does not issue USDT on Base: its
[supported protocols](https://tether.to/en/supported-protocols/) leave Base
out. The Base USDT is the standard-bridge token the
[Superchain token list](https://github.com/ethereum-optimism/ethereum-optimism.github.io/blob/master/data/USDT/data.json)
names; on chain its `l1Token()` is Ethereum's USDT
`0xdAC17F958D2ee523a2206206994597C13D831ec7` and its `l2Bridge()` the
L2StandardBridge `0x4200000000000000000000000000000000000010`. Its value
rests on that bridge, not on Tether.

Sources: Uniswap's [v3 Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)
(router, quoter, WETH), Circle's [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
(USDC). The ABIs follow `IV3SwapRouter`, `IMulticallExtended` and
`IPeripheryPaymentsWithFeeExtended` of
[Uniswap/swap-router-contracts](https://github.com/Uniswap/swap-router-contracts),
and `IQuoterV2` of [Uniswap/v3-periphery](https://github.com/Uniswap/v3-periphery).
The fee tiers are the ones QuoterV2 priced best for 0.001 ETH when the routes
were added. `test/swap.fork.test.ts` runs every route on a fork of
`BASE_RPC_URL` (`BASE_RPC_URL=… pnpm -C ts/packages/relayer-client test:fork`;
needs anvil), and skips without it. `test` leaves it out, and libID CI does not
run it.

## An agent's session

`agentPolicy` is a limited policy for an agent that tips handles from the
user's wallet, for `onboard`'s `session`:

```ts
const now = Number((await client.getBlock()).timestamp)
const agent = agentPolicy({ escrow, now, tokens: [{ token: usdc, amount: 10_000_000n }] })
await onboard({ ...onboarding, session: { key: agentKey, policy: agent.policy } })
```

The policy is non-admin, takes one signature, and ends 30 days after `now`
(`validUntil` overrides). Its scope allows `HandleEscrow.deposit` and
`depositToHandle`, each with at most `native` wei, and `approve` with no value
on each listed token. Its allowances, each a `period`, are `native` of
`NATIVE_TOKEN` and each token's `amount`. Defaults (`AGENT_DEFAULTS`): 0.01
ETH a day; a token's amount has no default, its units being the token's.
`approve` charges its amount to the token's allowance, whatever the spender.
An approval outlives the session: after `revokeSession` or `validUntil`, the
spender can still pull what the agent last approved. To revoke an agent, also
set to 0 the allowances it granted; the wallet's `Approval` logs name the
spenders.

The escrow pulls a token deposit with `transferFrom`, which the session does
not charge. A wallet with an agent session keeps no escrow allowance beyond
what the agent approves, or the agent can deposit all of it in one batch.

The agent signs its batches below quorum (`belowQuorumHash` of
`@libid/contracts`) and sends them itself: the relayer pays only for
sign-ins. `agent.scope.calls(executions)` gives the batch's
`Authorization.calls`, one proof per call, and throws for a call outside the
scope.

## Known limits

- Once the relayer drops a request's row, `waitFor` reads the chain, which
  cannot tell its request from another that onboarded the same wallet, and
  reads `received` at the latest block, not the inclusion block.

## Install

```sh
npm install @libid/relayer-client viem
```

`viem` is a peer dependency.

## Test

```sh
pnpm -C ts install
pnpm -C ts/packages/relayer-client test   # unit tests
```

The end-to-end tests run against the relayer's local stack, in
[libid-org/relayer](https://github.com/libid-org/relayer).
