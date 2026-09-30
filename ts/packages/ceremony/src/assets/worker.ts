import { allowedRequests, requestsByProfile } from 'virtual:ceremony-assets'
import { installPortKeeper } from '@libid/popup/worker'
import { hasExactKeys, isRecord } from '../primitives.js'
import { AssetCache } from './cache.js'
import { requestKey } from './keys.js'

/** Install the emitted fetch allowlist, cache delivery and popup-owned port continuity. */
export function startWorker(scope: ServiceWorkerGlobalScope): void {
  installPortKeeper()
  const cache = new AssetCache(scope.location.origin)
  const absolute = (r: (typeof allowedRequests)[number]) => ({
    ...r,
    url: new URL(r.url, scope.location.origin).href,
  })
  const allowed = new Map(allowedRequests.map(absolute).map((spec) => [requestKey(spec), spec]))
  const sameOriginClient = (source: ExtendableMessageEvent['source']) =>
    !!source && 'url' in source && new URL(source.url).origin === scope.location.origin

  /** Claim this client before it fetches execution assets. */
  function onClaim(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    if (!hasExactKeys(value, ['type']) || event.ports.length !== 1) return false
    const [port] = event.ports
    event.waitUntil(
      scope.clients.claim().then(() => {
        port.postMessage({ claimed: true })
        port.close()
      }),
    )
    return true
  }

  /** Acknowledge dispatch of every profile request; persistence keeps the worker alive. */
  function onPrefetch(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    if (
      event.ports.length !== 1 ||
      !hasExactKeys(value, ['type', 'profile']) ||
      typeof value.profile !== 'string' ||
      !Object.hasOwn(requestsByProfile, value.profile)
    )
      return false
    const [reply] = event.ports
    const jobs = requestsByProfile[value.profile].map((r) => cache.load(absolute(r)))
    for (const job of jobs) void job.response.catch(() => {})
    const dispatch = Promise.all(jobs.map((j) => j.dispatched)).then(() => {
      reply.postMessage({ dispatched: true })
      reply.close()
    })
    event.waitUntil(Promise.all([dispatch, ...jobs.map((j) => j.complete)]).then(() => {}))
    return true
  }

  scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
  scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
  scope.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return
    const spec = allowed.get(
      requestKey({
        url: event.request.url,
        range: event.request.headers.get('range') ?? undefined,
      }),
    )
    if (!spec) return
    const { response, complete } = cache.load(spec)
    event.respondWith(response)
    event.waitUntil(complete)
  })
  scope.addEventListener('message', (event) => {
    const value: unknown = event.data
    // Other traffic, including the popup port keeper's, passes untouched.
    if (!isRecord(value) || (value.type !== 'ceremony-claim' && value.type !== 'ceremony-prefetch'))
      return
    const handled =
      sameOriginClient(event.source) &&
      (value.type === 'ceremony-claim' ? onClaim(event, value) : onPrefetch(event, value))
    // An invalid ceremony request gets no reply; its ports close.
    if (!handled) for (const port of event.ports) port.close()
  })
}
