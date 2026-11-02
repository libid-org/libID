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

/** A validated stored copy, or undefined after removing a truncated range. */
async function cachedResponse(
  cache: Cache,
  key: string,
  spec: AssetRequest,
): Promise<Response | undefined> {
  const hit = await cache.match(key)
  if (!hit) return
  // Complete bodies were checked before cache.put; ordinary hits need no copy.
  if (!spec.range) {
    validateResponse(hit, spec)
    return hit
  }
  const bytes = await readBody(hit, spec.bytes ?? Number.MAX_SAFE_INTEGER)
  if (spec.bytes !== undefined && bytes.length !== spec.bytes) {
    await cache.delete(key)
    return
  }
  const response = new Response(bytes, { status: 206, headers: hit.headers })
  validateResponse(response, spec)
  return response
}

/** Validate and bound a fetched body; stored headers describe the decoded bytes. */
async function fetchedBody(
  received: Response,
  spec: AssetRequest,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; headers: Headers }> {
  validateResponse(received, spec)
  const bytes = await readBody(received, spec.bytes ?? Number.MAX_SAFE_INTEGER)
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

  constructor(private readonly origin: string) {}

  /** The stored key includes both the exact URL and Range, as a same-origin synthetic URL. */
  private storageKey(spec: AssetRequest): string {
    return this.origin + PREFIX + encodeURIComponent(requestKey(spec))
  }

  /** On activation, retain the complete release graph; inaccessible storage never blocks fetching. */
  async reconcile(required: Iterable<AssetRequest>): Promise<void> {
    try {
      const keep = new Set(Array.from(required, (spec) => this.storageKey(spec)))
      const cache = await caches.open(CACHE)
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
    const all = Array.from(specs)
    const retrieving = all
      .map((spec) => this.pending.get(requestKey(spec)))
      .filter((load) => load?.stage() === 'retrieving')
    const idle = all.filter((spec) => !this.pending.has(requestKey(spec)))
    const missing = await this.unstored(idle)
    await Promise.all(retrieving.map((load) => load!.response.catch(() => {})))
    return { pending: retrieving.length, missing }
  }

  /** How many `specs` Cache Storage lacks; inaccessible storage lacks all of them. */
  private async unstored(specs: AssetRequest[]): Promise<number> {
    try {
      const cache = await caches.open(CACHE)
      const hits = await Promise.all(specs.map((spec) => cache.match(this.storageKey(spec))))
      return hits.filter((hit) => !hit).length
    } catch {
      return specs.length
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
    const key = requestKey(spec)
    const existing = this.pending.get(key)
    if (existing) return this.share(existing)
    const dispatched = Promise.withResolvers<AssetSource>()
    let stage: ReturnType<PendingLoad['stage']> = 'lookup'
    let writing = Promise.resolve()
    const response = (async () => {
      const cacheKey = this.storageKey(spec)
      let cache: Cache | undefined
      try {
        cache = await caches.open(CACHE)
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
    return this.share(load)
  }

  private share({ dispatched, response, complete, stage }: PendingLoad) {
    return {
      dispatched: stage() === 'settled' ? Promise.resolve<AssetSource>('cache') : dispatched,
      response: response.then((r) => r.clone()),
      complete,
    }
  }
}
