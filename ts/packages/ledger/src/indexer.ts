import type { IndexerReader } from './client.js'
import { LedgerError } from './errors.js'
import type { Ledger } from './index.js'

export interface IndexerOptions {
  /** The indexer's origin: HTTPS, or HTTP on localhost for development. */
  origin: string
  /** The deployment, by ledger address name, the indexer must report indexing on each chain. */
  deployment: string
  /** How far behind the chain head the indexer may be, in blocks. Defaults to 20. */
  maxLag?: number
}

/** A libID indexer. One indexer serves every chain it reports. */
export interface Indexer {
  readonly deployment: string
  /** Runs a query's indexer implementation for a ledger; throws unless the index is current. */
  read<A extends readonly unknown[], R>(
    ledger: Ledger,
    run: (read: IndexerReader, ...args: A) => Promise<R>,
    args: A,
    signal?: AbortSignal,
  ): Promise<R>
}

export function indexer({ origin, deployment, maxLag = 20 }: IndexerOptions): Indexer {
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

  /** GETs a JSON object; any failure but the caller's abort means the indexer is unavailable. */
  async function get(
    path: string,
    params: Record<string, string> | undefined,
    signal: AbortSignal,
    outer?: AbortSignal,
  ) {
    try {
      const search = params ? `?${new URLSearchParams(params)}` : ''
      const response = await fetch(`${origin}${path}${search}`, {
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`Indexer request failed (${response.status}).`)
      return object(await response.json())
    } catch (error) {
      if (outer?.aborted) throw error
      throw new LedgerError('indexer-unavailable', { cause: error })
    }
  }

  /** The ledger's last indexed block, if the index is current and covers the deployment. */
  async function status(ledger: Ledger, signal: AbortSignal, outer?: AbortSignal): Promise<number> {
    // ponytail: the libID indexer keys chains by EVM chain id; extend its protocol for other families.
    const chainId = Number(ledger.chain.slice(ledger.chain.indexOf(':') + 1))
    const contract = ledger.addresses[deployment]?.toLowerCase()
    // ponytail: two status requests per read; share one per moment if many chains read at once.
    const data = await get('/v1/status', undefined, signal, outer)
    const chains = Array.isArray(data.chains)
      ? data.chains.filter(
          (chain) => chain && typeof chain === 'object' && chain.chainId === chainId,
        )
      : []
    const chain = chains[0]
    if (
      !contract ||
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
      throw new LedgerError('indexer-unavailable', { cause: chain ?? data })
    }
    return chain.lastIndexedBlock
  }

  return {
    deployment,
    async read(ledger, run, args, outer) {
      const timeout = AbortSignal.timeout(15_000)
      const signal = outer ? AbortSignal.any([outer, timeout]) : timeout
      signal.throwIfAborted()
      const before = await status(ledger, signal, outer)
      const result = await run(
        { ledger, block: BigInt(before), get: (path, params) => get(path, params, signal, outer) },
        ...args,
      )
      // An index that moved backwards (a reorg or reindex) may have served mixed state.
      if ((await status(ledger, signal, outer)) < before) {
        throw new LedgerError('indexer-unavailable', { cause: 'The index moved backwards.' })
      }
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
