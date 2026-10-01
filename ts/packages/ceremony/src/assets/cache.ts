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

/** Single-flight delivery of immutable bytes. Storage failure falls back to the same fetch. */
export class AssetCache {
  private readonly pending = new Map<
    string,
    { dispatched: Promise<void>; response: Promise<Response>; complete: Promise<void> }
  >()

  constructor(private readonly origin: string) {}

  /**
   * Join one URL/range fetch, with an independently consumable response for each caller.
   * `dispatched` acknowledges a cache hit or fetch invocation, allowing OAuth navigation.
   * `response` validates the body before delivery; `complete` keeps the worker and pending
   * entry alive through best-effort cache persistence, without delaying delivery.
   */
  load(spec: AssetRequest) {
    const key = requestKey(spec)
    const existing = this.pending.get(key)
    if (existing) return { ...existing, response: existing.response.then((r) => r.clone()) }
    const dispatched = Promise.withResolvers<void>()
    let writing = Promise.resolve()
    const response = (async () => {
      const cacheKey = this.origin + PREFIX + encodeURIComponent(key)
      let cache: Cache | undefined
      try {
        cache = await caches.open(CACHE)
        const hit = await cachedResponse(cache, cacheKey, spec)
        if (hit) return hit
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
      dispatched.resolve()
      const { bytes, headers } = await fetchedBody(await fetching, spec)
      const stored = new Response(bytes, { headers })
      // A valid response remains usable when storage is full.
      if (cache) writing = cache.put(cacheKey, stored.clone()).catch(() => {})
      return spec.range ? new Response(bytes, { status: 206, headers }) : stored
    })().finally(dispatched.resolve)
    const complete = response
      .catch(() => {})
      .then(() => writing)
      .finally(() => {
        this.pending.delete(key)
      })
    const started = dispatched.promise
    this.pending.set(key, { dispatched: started, response, complete })
    return { dispatched: started, response: response.then((r) => r.clone()), complete }
  }
}
