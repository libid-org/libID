import { allowedRequests, requestsByProfile } from 'virtual:ceremony-assets'
import { installPortKeeper } from '@libid/popup/worker'
import { hasExactKeys, isRecord } from '../primitives.js'
import { AssetCache } from './cache.js'
import { requestKey } from './keys.js'

/** Install the emitted fetch allowlist, cache delivery and popup-owned port continuity. */
export function startRootWorker(scope: ServiceWorkerGlobalScope): void {
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

  /** The profile a request with exactly one reply port names, if well formed. */
  const profileOf = (event: ExtendableMessageEvent, value: Record<string, unknown>) =>
    event.ports.length === 1 &&
    hasExactKeys(value, ['type', 'profile']) &&
    typeof value.profile === 'string'
      ? value.profile
      : undefined

  /**
   * Acknowledge dispatch of every profile request, counting stored and fetched ones; persistence
   * keeps the worker alive.
   */
  function onPrefetch(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    const profile = profileOf(event, value)
    if (profile === undefined) return false
    const [reply] = event.ports
    // A build without this asset list (an older worker, or a retired version) says so at once.
    if (!Object.hasOwn(requestsByProfile, profile)) {
      reply.postMessage({ dispatched: false })
      reply.close()
      return true
    }
    const jobs = requestsByProfile[profile].map((r) => cache.load(absolute(r)))
    for (const job of jobs) void job.response.catch(() => {})
    const dispatch = Promise.all(jobs.map((j) => j.dispatched)).then((sources) => {
      const cached = sources.filter((source) => source === 'cache').length
      reply.postMessage({ dispatched: true, cached, fetched: sources.length - cached })
      reply.close()
    })
    event.waitUntil(Promise.all([dispatch, ...jobs.map((j) => j.complete)]).then(() => {}))
    return true
  }

  /** Report the profile's still-running and missing retrievals, once the running ones settle. */
  function onDownloads(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    const profile = profileOf(event, value)
    if (profile === undefined || !Object.hasOwn(requestsByProfile, profile)) return false
    const [reply] = event.ports
    event.waitUntil(
      cache.remaining(requestsByProfile[profile].map(absolute)).then((report) => {
        reply.postMessage(report)
        reply.close()
      }),
    )
    return true
  }

  const handlers: Record<string, typeof onClaim> = {
    'ceremony-claim': onClaim,
    'ceremony-prefetch': onPrefetch,
    'ceremony-downloads': onDownloads,
  }

  scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
  scope.addEventListener('activate', (event) =>
    event.waitUntil(Promise.all([cache.reconcile(allowed.values()), scope.clients.claim()])),
  )
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
    if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(handlers, value.type))
      return
    const handled = sameOriginClient(event.source) && handlers[value.type](event, value)
    // An invalid ceremony request gets no reply; its ports close.
    if (!handled) for (const port of event.ports) port.close()
  })
}
