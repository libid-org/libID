import type { IndexerReader } from './client.js'
import type { Ledger } from './index.js'

export interface IndexerAccess {
  /** The indexer's origin: HTTPS, or HTTP on localhost for development. */
  origin: string
  /** The ledger deployment, by name, the indexer must report indexing. */
  deployment: string
  /** How far behind the chain head the indexer may be, in blocks. Defaults to 20. */
  maxLag?: number
}

export type Indexer = ReturnType<typeof indexer>

/** @internal Runs queries' indexer implementations against a libID indexer. */
export function indexer(ledger: Ledger, { origin, deployment, maxLag = 20 }: IndexerAccess) {
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
    !Number.isSafeInteger(maxLag) ||
    maxLag < 0
  ) {
    throw new TypeError('Invalid indexer configuration.')
  }
  const contract = ledger.addresses[deployment]?.toLowerCase()
  if (!contract) throw new TypeError(`${ledger.name} has no ${deployment} address`)
  // ponytail: the libID indexer keys chains by EVM chain id; extend its protocol for other families.
  const chainId = Number(ledger.chain.slice(ledger.chain.indexOf(':') + 1))

  async function get(
    path: string,
    params: Record<string, string> | undefined,
    signal: AbortSignal,
  ) {
    const search = params ? `?${new URLSearchParams(params)}` : ''
    const response = await fetch(`${origin}${path}${search}`, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Indexer request failed (${response.status}).`)
    return object(await response.json())
  }

  /** The last indexed block, if the indexer is current and indexes this deployment. */
  async function status(signal: AbortSignal): Promise<number> {
    const data = await get('/v1/status', undefined, signal)
    if (!Array.isArray(data.chains)) throw new Error('Invalid indexer status.')
    const chains = data.chains.map(object).filter((chain) => chain.chainId === chainId)
    const chain = chains[0]
    if (
      chains.length !== 1 ||
      typeof chain.contract !== 'string' ||
      chain.contract.toLowerCase() !== contract ||
      !block(chain.lastIndexedBlock) ||
      !block(chain.chainHeadBlock) ||
      !block(chain.lagBlocks) ||
      chain.lagBlocks > maxLag ||
      chain.chainHeadBlock < chain.lastIndexedBlock ||
      chain.chainHeadBlock - chain.lastIndexedBlock > maxLag ||
      typeof chain.reportValidFor !== 'number' ||
      !Number.isFinite(chain.reportValidFor) ||
      chain.reportValidFor <= 0 ||
      chain.lastWindowError !== null
    ) {
      throw new Error('Indexer is unavailable, behind, or indexing another deployment.')
    }
    return chain.lastIndexedBlock
  }

  return {
    async read<A extends readonly unknown[], R>(
      run: (read: IndexerReader, ...args: A) => Promise<R>,
      args: A,
      outer?: AbortSignal,
    ): Promise<R> {
      const timeout = AbortSignal.timeout(15_000)
      const signal = outer ? AbortSignal.any([outer, timeout]) : timeout
      signal.throwIfAborted()
      const before = await status(signal)
      const result = await run(
        { ledger, block: BigInt(before), get: (path, params) => get(path, params, signal) },
        ...args,
      )
      // An index that moved backwards (a reorg or reindex) may have served mixed state.
      if ((await status(signal)) < before) throw new Error('Indexer state changed while reading.')
      return result
    },
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid indexer response.')
  }
  return value as Record<string, unknown>
}

function block(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
