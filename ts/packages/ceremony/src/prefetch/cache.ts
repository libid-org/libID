import type { AssetRequest } from '../assets.js'
import { readBody } from '../response.js'

const CACHE = 'libid-ceremony-assets-v1',
  PREFIX = '/__libid_ceremony_cache__/'
/** Validate status and exposed metadata before accepting an asset response. */
export function validateResponse(response: Response, spec: AssetRequest): void {
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
  if (
    spec.range &&
    range &&
    !new RegExp(`^bytes ${spec.range.slice(6)}/(?:[1-9][0-9]*|\\*)$`).test(range)
  )
    throw new Error('Unexpected asset range')
  if (
    spec.bytes !== undefined &&
    range &&
    range.split('/')[1] !== '*' &&
    BigInt(range.split('/')[1]) < BigInt(spec.bytes)
  )
    throw new Error('Invalid asset total')
  const length = response.headers.get('content-length')
  if (
    length !== null &&
    (!/^[0-9]+$/.test(length) || (spec.bytes !== undefined && Number(length) !== spec.bytes)) &&
    !response.headers.has('content-encoding')
  )
    throw new Error('Unexpected asset size')
}
export class AssetCache {
  private readonly pending = new Map<
    string,
    { dispatched: Promise<void>; response: Promise<Response> }
  >()
  constructor(private readonly origin: string) {}
  load(spec: AssetRequest) {
    const key = `${spec.url}\n${spec.range ?? ''}`
    const existing = this.pending.get(key)
    if (existing)
      return { dispatched: existing.dispatched, response: existing.response.then((r) => r.clone()) }
    let dispatched!: () => void
    const started = new Promise<void>((resolve) => {
      dispatched = resolve
    })
    const response = (async () => {
      let cache: Cache | undefined
      const cacheKey = this.origin + PREFIX + encodeURIComponent(key)
      try {
        cache = await caches.open(CACHE)
        const hit = await cache.match(cacheKey)
        if (hit) {
          // Complete bodies were checked before cache.put; ordinary hits need no copy.
          if (!spec.range) {
            validateResponse(hit, spec)
            dispatched()
            return hit
          }
          const bytes = await readBody(hit, spec.bytes ?? Number.MAX_SAFE_INTEGER)
          if (spec.bytes === undefined || bytes.length === spec.bytes) {
            const response = new Response(bytes.slice().buffer, {
              status: 206,
              headers: hit.headers,
            })
            validateResponse(response, spec)
            dispatched()
            return response
          }
          await cache.delete(cacheKey)
        }
      } catch {
        /* Storage denial does not disable fetching. */
      }
      let fetching: Promise<Response>
      try {
        fetching = fetch(spec.url, {
          credentials: 'omit',
          mode: 'cors',
          redirect: 'error',
          headers: spec.range ? { Range: spec.range } : {},
          cache: 'force-cache',
        })
      } finally {
        dispatched()
      }
      const received = await fetching
      validateResponse(received, spec)
      const bytes = await readBody(received, spec.bytes ?? Number.MAX_SAFE_INTEGER)
      if (spec.bytes !== undefined && bytes.length !== spec.bytes)
        throw new Error('Incomplete asset body')
      const headers = new Headers(received.headers)
      headers.delete('content-encoding')
      headers.set('content-length', String(bytes.length))
      const stored = new Response(bytes.slice().buffer, { headers })
      if (cache)
        try {
          await cache.put(cacheKey, stored.clone())
        } catch {
          /* A valid response remains usable when storage is full. */
        }
      return spec.range
        ? new Response(bytes.slice().buffer, { status: 206, headers: stored.headers })
        : stored
    })().finally(() => {
      dispatched()
      this.pending.delete(key)
    })
    void response.catch(() => {})
    this.pending.set(key, { dispatched: started, response })
    return { dispatched: started, response: response.then((r) => r.clone()) }
  }
}
