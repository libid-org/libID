import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  Eip1559FeesNotSupportedError,
  getAddress,
  http,
  isAddress,
  type Chain,
  type PublicClient,
  type Transport,
  toHex,
} from 'viem'
import type { Access, LedgerClient, Session } from '../client.js'
import { errorCode, LedgerError } from '../errors.js'
import type { Account, Ledger } from '../index.js'
import type { Provider, Reader, Tx } from './index.js'

type Request = { method: string; params?: unknown }
type Client = PublicClient<Transport, Chain>

/** Read-only methods used by queries, simulation and fee estimation. */
export const readMethods: readonly string[] = Object.freeze([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_getBalance',
  'eth_getCode',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
])
const sendMethods = ['eth_sendTransaction', 'wallet_sendTransaction']

export function eip155<L extends Ledger>(ledger: L, access: Access): LedgerClient<L> {
  const chainId = Number(ledger.chain.slice('eip155:'.length))
  if (!Number.isSafeInteger(chainId)) throw new TypeError(`Unsupported EVM chain: ${ledger.chain}`)
  const chain = defineChain({
    id: chainId,
    name: ledger.name,
    nativeCurrency: { name: ledger.currency.symbol, ...ledger.currency },
    rpcUrls: { default: { http: [access.rpc] } },
    blockExplorers: access.explorer
      ? { default: { name: 'Explorer', url: access.explorer } }
      : undefined,
    testnet: ledger.testnet,
  })
  const rpc = http(access.rpc, { timeout: 15_000, retryCount: 1 })
  const fallback = rpc({ chain })
  const parseAccount = (raw: string) => getAddress(raw) as Account

  function reads(client: Client) {
    return {
      ledger,
      walletRequirements: Object.freeze({
        methods: Object.freeze([
          'eth_sendTransaction',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
          ...readMethods,
        ]),
        events: Object.freeze(['accountsChanged', 'chainChanged']),
      }),
      parseAccount,
      async read<A extends readonly unknown[], R>(
        query: { eip155: (read: Reader, ...args: A) => Promise<R> },
        args: A,
        { signal }: { signal?: AbortSignal } = {},
      ): Promise<R> {
        signal?.throwIfAborted()
        const block = await client.getBlockNumber({ cacheTime: 0 })
        // Every action defaults to the same block, so a query sees one consistent state.
        const pin = <F>(action: unknown, key: 'blockNumber' | 'toBlock'): F =>
          (async (params: object) => {
            signal?.throwIfAborted()
            const result = await (action as (params: object) => Promise<unknown>)({
              [key]: block,
              ...params,
            })
            signal?.throwIfAborted()
            return result
          }) as F
        const reader: Reader = {
          ledger: ledger as Ledger<`eip155:${string}`>,
          block,
          readContract: pin(client.readContract, 'blockNumber'),
          getContractEvents: pin(client.getContractEvents, 'toBlock'),
          getBalance: pin(client.getBalance, 'blockNumber'),
          call: pin(client.call, 'blockNumber'),
          address(name) {
            const value = ledger.addresses[name]
            if (!value) throw new TypeError(`${ledger.name} has no ${name} address`)
            return getAddress(value)
          },
          parseAccount,
        }
        return query.eip155(reader, ...args)
      },
      tx<A extends readonly unknown[]>(
        command: { eip155: (ledger: Ledger, ...args: A) => Tx },
        args: A,
      ): Tx {
        return command.eip155(ledger, ...args)
      },
      async estimate(tx: Tx, from: Account): Promise<bigint> {
        const [gas, fees] = await Promise.all([
          client.estimateGas({ ...tx, account: from as `0x${string}` }),
          client.estimateFeesPerGas().catch((error) => {
            if (!(error instanceof Eip1559FeesNotSupportedError)) throw error
            return client.estimateFeesPerGas({ type: 'legacy' })
          }),
        ])
        return gas * (fees.maxFeePerGas ?? fees.gasPrice)
      },
    }
  }

  async function switchChain(provider: Provider) {
    const params = [{ chainId: toHex(chainId) }]
    try {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params })
      } catch (error) {
        if (errorCode(error) !== 4902) throw error
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: toHex(chainId),
              chainName: ledger.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [access.rpc],
              blockExplorerUrls: access.explorer ? [access.explorer] : undefined,
            },
          ],
        })
        if ((await walletChain(provider)) !== chainId) {
          await provider.request({ method: 'wallet_switchEthereumChain', params })
        }
      }
    } catch (error) {
      throw walletError(error, 'wrong-chain')
    }
    if ((await walletChain(provider)) !== chainId) throw new LedgerError('wrong-chain')
  }

  function session(provider: Provider, address: `0x${string}`): Session<L> {
    const transport = walletReads(provider, chainId, fallback)
    const client: Client = createPublicClient({
      chain,
      transport: custom(transport, { retryCount: 0 }),
    })
    return {
      ...reads(client),
      account: address as Account,
      async send(tx: Tx) {
        let requested = false
        try {
          const [current, walletChainId] = await Promise.all([
            walletAccount(provider, false),
            walletChain(provider),
          ])
          if (current !== address || walletChainId !== chainId) {
            throw new LedgerError('wallet-changed')
          }
          await client.call({ ...tx, account: address })
          const signer = createWalletClient({
            account: address,
            chain,
            transport: custom({
              async request(request: Request) {
                // Everything before this point provably sent nothing.
                if (sendMethods.includes(request.method)) requested = true
                return provider.request(request)
              },
            }),
          })
          return await signer.sendTransaction(tx)
        } catch (error) {
          if (!requested) {
            throw error instanceof LedgerError
              ? error
              : new LedgerError('not-sent', { cause: error })
          }
          if (errorCode(error) === 4001) throw new LedgerError('rejected', { cause: error })
          throw error
        }
      },
      close: transport.close,
    } as Session<L>
  }

  const base = reads(createPublicClient({ chain, transport: rpc }))
  return {
    ...base,
    async connect(provider, { prompt = true } = {}) {
      let address: `0x${string}` | null
      try {
        address = await walletAccount(provider, prompt)
      } catch (error) {
        throw walletError(error, 'no-account')
      }
      if (!address) throw new LedgerError('no-account')
      if ((await walletChain(provider)) !== chainId) {
        if (!prompt) throw new LedgerError('wrong-chain')
        await switchChain(provider)
      }
      return session(provider, address)
    },
  } as LedgerClient<L>
}

function walletError(error: unknown, otherwise: 'no-account' | 'wrong-chain') {
  return new LedgerError(errorCode(error) === 4001 ? 'rejected' : otherwise, { cause: error })
}

async function walletAccount(provider: Provider, prompt: boolean) {
  const accounts = await provider.request({
    method: prompt ? 'eth_requestAccounts' : 'eth_accounts',
  })
  const [first] = Array.isArray(accounts) ? accounts : []
  return typeof first === 'string' && isAddress(first) ? getAddress(first) : null
}

async function walletChain(provider: Provider): Promise<number> {
  const value = await provider.request({ method: 'eth_chainId' })
  // WalletConnect's provider returns a number for this request.
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  ) {
    throw new Error('The wallet returned an invalid network.')
  }
  return Number(value)
}

type WalletConnectSession = {
  session?: { namespaces?: Record<string, { accounts: string[]; methods: string[] }> }
}

/** A WalletConnect provider exposes its CAIP-25 session; injected providers do not. */
const isWalletConnect = (provider: Provider) => 'session' in provider

function approved(provider: Provider, chainId: number, method: string) {
  if (!isWalletConnect(provider) || method === 'eth_chainId') return true
  const chain = `eip155:${chainId}`
  const namespaces = (provider as WalletConnectSession).session?.namespaces ?? {}
  return Object.entries(namespaces).some(
    ([key, namespace]) =>
      (key === 'eip155' || key === chain) &&
      namespace.accounts.some((account) => account.startsWith(`${chain}:`)) &&
      namespace.methods.includes(method),
  )
}

/**
 * @internal Reads through the wallet's RPC when it supports them, otherwise `fallback`.
 * A read that crosses a chain change is discarded rather than trusted.
 */
export function walletReads(
  provider: Provider,
  chainId: number,
  fallback: { request(request: never): Promise<unknown> },
) {
  const context = { closed: false, unsupported: new Set<string>(), revision: 0, retryAfter: 0 }
  const unavailable = new Error('Wallet RPC changed or is on another network.')
  const timedOut = new Error('Wallet RPC timed out.')
  const changed = () => {
    context.revision++
    context.unsupported.clear()
    context.retryAfter = 0
  }
  const events = ['chainChanged', 'disconnect', 'connect']
  for (const event of events) provider.on(event, changed)
  const toFallback = (request: Request) =>
    (fallback.request as (request: Request) => Promise<unknown>)(request)
  return {
    async request(request: Request): Promise<unknown> {
      if (!readMethods.includes(request.method)) {
        throw new TypeError(`${request.method} is not a read method.`)
      }
      if (
        !context.closed &&
        !context.unsupported.has(request.method) &&
        Date.now() >= context.retryAfter &&
        approved(provider, chainId, request.method)
      ) {
        const revision = context.revision
        const current = () => !context.closed && context.revision === revision
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            (async () => {
              if ((await walletChain(provider)) !== chainId || !current()) throw unavailable
              const result =
                request.method === 'eth_chainId' ? toHex(chainId) : await provider.request(request)
              if (!current() || (await walletChain(provider)) !== chainId || !current()) {
                throw unavailable
              }
              return result
            })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(timedOut), 5_000)
            }),
          ])
        } catch (error) {
          const failure = readFailure(error, isWalletConnect(provider))
          if (!current() || error === unavailable) {
            // Discard reads that crossed a chain change, including away and back.
          } else if (failure === 'unsupported') {
            context.unsupported.add(request.method)
          } else if (error === timedOut || failure === 'unavailable') {
            // Retry transient wallet failures later, without delaying every read.
            context.retryAfter = Date.now() + 30_000
          } else {
            // A revert, rejection or invalid input is not evidence of missing RPC support.
            throw error
          }
        } finally {
          clearTimeout(timer)
        }
      }
      if (!context.closed && request.method === 'eth_maxPriorityFeePerGas') {
        // Let viem derive the tip from the wallet's gas price and base fee before using HTTP.
        throw Object.assign(new Error('Priority fee is unavailable from the wallet.'), {
          code: 4200,
        })
      }
      return toFallback(request)
    },
    close() {
      if (context.closed) return
      context.closed = true
      for (const event of events) provider.removeListener(event, changed)
    },
  }
}

function readFailure(error: unknown, walletConnect: boolean) {
  const pending = [error]
  const seen = new Set<object>()
  let failure: 'unsupported' | 'unavailable' | undefined
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    // Error objects can be cyclic. Refuse ambiguous, excessively nested wrappers.
    if (seen.size === 16) return
    seen.add(value)
    const { code, status, statusCode, name, message, details, shortMessage, data } =
      value as Record<string, unknown>
    const httpStatus = status ?? statusCode
    const unsupported =
      code === 4200 || code === -32601 || code === -32004 || (walletConnect && code === 5101)
    const unavailable =
      code === 4900 || code === 4901 || code === 429 || code === -32005 || code === -32002
    const transportError =
      ['NetworkError', 'TimeoutError', 'SocketClosedError', 'WebSocketRequestError'].includes(
        String(name),
      ) &&
      (typeof code !== 'number' ||
        (name === 'NetworkError' && code === 19) ||
        (name === 'TimeoutError' && code === 23))
    if (
      (typeof code === 'number' &&
        code !== -32603 &&
        !unsupported &&
        !unavailable &&
        !transportError) ||
      ['ACTION_REJECTED', 'CALL_EXCEPTION', 'INVALID_ARGUMENT'].includes(String(code)) ||
      name === 'AbortError' ||
      (typeof httpStatus === 'number' &&
        httpStatus >= 400 &&
        httpStatus < 500 &&
        httpStatus !== 408 &&
        httpStatus !== 429) ||
      (typeof data === 'string' && /^0x[\da-f]*$/i.test(data)) ||
      [message, details, shortMessage].some(
        (text) =>
          typeof text === 'string' &&
          /\brevert(?:ed)?\b|\buser (?:rejected|denied)\b|\bunauthori[sz]ed\b|\binvalid (?:params|parameters|input|request)\b/i.test(
            text,
          ),
      )
    ) {
      return
    }
    if (
      unavailable ||
      (typeof httpStatus === 'number' &&
        (httpStatus === 408 || httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600))) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(
        String(code),
      ) ||
      transportError ||
      (typeof message === 'string' &&
        /^(?:TypeError: )?(?:failed to fetch|fetch failed|network request failed|NetworkError when attempting to fetch resource\.?|load failed)$/i.test(
          message,
        ))
    ) {
      failure = 'unavailable'
    } else if (unsupported && !failure) {
      failure = 'unsupported'
    }
    // Inspect all wrappers before accepting a transport failure: a nested refusal wins.
    for (const key of ['cause', 'error', 'originalError', 'data'] as const) {
      pending.push((value as Record<string, unknown>)[key])
    }
  }
  return failure
}
