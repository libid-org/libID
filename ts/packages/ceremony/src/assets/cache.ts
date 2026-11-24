import { readBody } from '../response.js'
import type { AssetRequest } from './index.js'
import { requestKey } from './keys.js'

const CACHE = 'libid-ceremony-assets-v1'
const PREFIX = '/__libid_ceremony_cache__/'

/** Validate status and exposed metadata before accepting an asset response. */
function validateResponse(response: Response, spec: AssetRequest): void {
  if (
    response.redirected ||
    response.type === 'opaque' ||
    response.type === 'opaqueredirect' ||
    response.status !== (spec.range ? 206 : 200)
  )
    throw new Error('Invalid asset response')
  if (spec.mime && response.headers.get('content-type')?.split(';')[0].trim() !== spec.mime)
    throw new Error('Invalid asset media type')
  const range = response.headers.get('content-range')
  if (range) validateContentRange(range, spec)
  // A CORS response hides Content-Encoding, so its length may be the encoded one; the body
  // read still bounds the decoded bytes.
  const length = response.headers.get('content-length')
  if (
    length !== null &&
    (!/^[0-9]+$/.test(length) || (spec.bytes !== undefined && Number(length) !== spec.bytes)) &&
    !response.headers.has('content-encoding') &&
    response.type !== 'cors'
  )
    throw new Error('Unexpected asset size')
}

/** A returned range matches the requested one; a known complete length covers the declared size. */
function validateContentRange(range: string, spec: AssetRequest): void {
  const match = /^bytes ([0-9]+-[0-9]+)\/([1-9][0-9]*|\*)$/.exec(range)
  if (!match || (spec.range && spec.range !== `bytes=${match[1]}`))
    throw new Error('Unexpected asset range')
  if (spec.bytes !== undefined && match[2] !== '*' && BigInt(match[2]) < BigInt(spec.bytes))
    throw new Error('Invalid asset total')
}

/** A validated stored copy, or undefined after evicting an invalid entry. */
async function cachedResponse(
  cache: Cache,
  key: string,
  spec: AssetRequest,
): Promise<Response | undefined> {
  const hit = await cache.match(key)
  if (!hit) return
  // Complete bodies were checked and length-tagged before cache.put; both ordinary and ranged
  // hits stream directly without rereading or copying the body.
  try {
    if (
      hit.redirected ||
      hit.type === 'opaque' ||
      hit.type === 'opaqueredirect' ||
      hit.status !== 200 ||
      hit.headers.has('content-encoding') ||
      (spec.bytes !== undefined && hit.headers.get('content-length') !== String(spec.bytes))
    )
      throw new Error('Invalid cached asset')
    const response = spec.range
      ? new Response(hit.body, { status: 206, headers: hit.headers })
      : hit
    validateResponse(response, spec)
    return response
  } catch {
    try {
      await cache.delete(key)
    } catch {
      /* Deletion failure does not disable fetching. */
    }
    return
  }
}

/** Validate and bound a fetched body; stored headers describe the decoded bytes. */
async function fetchedBody(
  received: Response,
  spec: AssetRequest,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; headers: Headers }> {
  validateResponse(received, spec)
  const bytes = await readBody(
    received,
    spec.bytes ?? Number.MAX_SAFE_INTEGER,
    spec.bytes !== undefined,
  )
  if (spec.bytes !== undefined && bytes.length !== spec.bytes)
    throw new Error('Incomplete asset body')
  const headers = new Headers(received.headers)
  headers.delete('content-encoding')
  headers.set('content-length', String(bytes.length))
  return { bytes, headers }
}

/** Where a load's bytes come from: stored bytes, or a network retrieval (possibly joined). */
export type AssetSource = 'cache' | 'network'

interface PendingLoad {
  dispatched: Promise<AssetSource>
  response: Promise<Response>
  complete: Promise<void>
  /** A cache lookup, a network retrieval, then a settled response while persistence finishes. */
  stage: () => 'lookup' | 'retrieving' | 'settled'
}

/** Single-flight delivery of immutable bytes. Storage failure falls back to the same fetch. */
export class AssetCache {
  private readonly pending = new Map<string, PendingLoad>()
  private opening?: Promise<Cache>

  constructor(private readonly origin: string) {}

  /** Coalesce concurrent `caches.open` calls without retaining a handle across cache deletion. */
  private openCache(): Promise<Cache> {
    if (!this.opening)
      this.opening = caches.open(CACHE).finally(() => {
        this.opening = undefined
      })
    return this.opening
  }

  /** The stored key includes both the exact URL and Range, as a same-origin synthetic URL. */
  private storageKey(spec: AssetRequest): string {
    return this.origin + PREFIX + encodeURIComponent(requestKey(spec))
  }

  /** On activation, retain the complete release graph; inaccessible storage never blocks fetching. */
  async reconcile(required: Iterable<AssetRequest>): Promise<void> {
    try {
      const keep = new Set(Array.from(required, (spec) => this.storageKey(spec)))
      const cache = await this.openCache()
      await Promise.all(
        (await cache.keys())
          .filter((key) => key.url.startsWith(this.origin + PREFIX) && !keep.has(key.url))
          .map((key) => cache.delete(key).catch(() => false)),
      )
    } catch {
      /* Cache maintenance is best effort, independent of ceremony readiness. */
    }
  }

  /**
   * Settle the running network retrievals of `specs`. `pending` counts them; `missing` counts
   * specs neither loading nor stored, such as a retrieval lost with a stopped worker.
   */
  async remaining(specs: Iterable<AssetRequest>): Promise<{ pending: number; missing: number }> {
    const retrieving: PendingLoad[] = []
    const lookups: PendingLoad[] = []
    const idle: AssetRequest[] = []
    for (const spec of specs) {
      const load = this.pending.get(requestKey(spec))
      if (!load) idle.push(spec)
      else if (load.stage() === 'retrieving') retrieving.push(load)
      else if (load.stage() === 'lookup') lookups.push(load)
    }
    const [missing, sources] = await Promise.all([
      this.unstored(idle),
      Promise.all(lookups.map((load) => load.dispatched)),
    ])
    for (let i = 0; i < lookups.length; i++)
      if (sources[i] === 'network') retrieving.push(lookups[i])
    await Promise.all(retrieving.map((load) => load.response.catch(() => {})))
    return { pending: retrieving.length, missing }
  }

  /** How many `specs` Cache Storage lacks; inaccessible storage lacks all of them. */
  private async unstored(specs: AssetRequest[]): Promise<number> {
    if (!specs.length) return 0
    try {
      const cache = await this.openCache()
      const stored = new Set((await cache.keys()).map((key) => key.url))
      return specs.filter((spec) => !stored.has(this.storageKey(spec))).length
    } catch {
      return specs.length
    }
  }

  /**
   * Ensure one URL/range entry is stored or fetching, without cloning or reading a cached body.
   * Joins any running flight for the same URL/range; a miss starts the same single-flight fetch
   * that `load` can join.
   */
  prefetch(spec: AssetRequest): { dispatched: Promise<AssetSource>; complete: Promise<void> } {
    const load = this.flight(spec)
    return {
      dispatched:
        load.stage() === 'settled' ? Promise.resolve<AssetSource>('cache') : load.dispatched,
      complete: load.complete,
    }
  }

  /**
   * Join one URL/range fetch, with an independently consumable response for each caller.
   * `dispatched` acknowledges a cache hit or fetch invocation, allowing OAuth navigation, and
   * names the source; a joiner shares the first caller's, or `cache` once its bytes arrived.
   * `response` validates the body before delivery; `complete` keeps the worker and pending
   * entry alive through best-effort cache persistence, without delaying delivery.
   */
  load(spec: AssetRequest) {
    return this.share(this.flight(spec))
  }

  /** Return the existing flight for `spec` or start one backed by Cache Storage then `fetch`. */
  private flight(spec: AssetRequest): PendingLoad {
    const key = requestKey(spec)
    const existing = this.pending.get(key)
    if (existing) return existing
    const dispatched = Promise.withResolvers<AssetSource>()
    let stage: ReturnType<PendingLoad['stage']> = 'lookup'
    let writing = Promise.resolve()
    const response = (async () => {
      const cacheKey = this.storageKey(spec)
      let cache: Cache | undefined
      try {
        cache = await this.openCache()
        const hit = await cachedResponse(cache, cacheKey, spec)
        if (hit) {
          dispatched.resolve('cache')
          return hit
        }
      } catch {
        /* Storage denial does not disable fetching. */
      }
      const fetching = fetch(spec.url, {
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        headers: spec.range ? { Range: spec.range } : {},
        cache: 'force-cache',
      })
      stage = 'retrieving'
      dispatched.resolve('network')
      const { bytes, headers } = await fetchedBody(await fetching, spec)
      const stored = new Response(bytes, { headers })
      // A valid response remains usable when storage is full.
      if (cache) writing = cache.put(cacheKey, stored.clone()).catch(() => {})
      return spec.range ? new Response(bytes, { status: 206, headers }) : stored
    })().finally(() => {
      stage = 'settled'
      dispatched.resolve('network')
    })
    const complete = response
      .catch(() => {})
      .then(() => writing)
      .finally(() => {
        this.pending.delete(key)
      })
    const load: PendingLoad = {
      dispatched: dispatched.promise,
      response,
      complete,
      stage: () => stage,
    }
    this.pending.set(key, load)
    return load
  }

  private share({ dispatched, response, complete, stage }: PendingLoad) {
    return {
      dispatched: stage() === 'settled' ? Promise.resolve<AssetSource>('cache') : dispatched,
      response: response.then((r) => r.clone()),
      complete,
    }
  }
}
