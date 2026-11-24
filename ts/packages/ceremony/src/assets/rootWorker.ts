import { allowedRequests, requestsByProfile } from 'virtual:ceremony-assets'
import { installPortKeeper } from '@libid/popup/worker'
import { now } from '../events.js'
import { hasExactKeys, isRecord } from '../primitives.js'
import { AssetCache } from './cache.js'
import { Journal } from './journal.js'
import { requestKey } from './keys.js'

/** Page loads bypass this Worker, which serves only allowlisted assets (Static Routing API). */
function routeNavigations(event: ExtendableEvent): Promise<void> {
  const install = event as ExtendableEvent & { addRoutes?: (rule: object) => Promise<void> }
  try {
    const routed = install.addRoutes?.({
      condition: { requestMode: 'navigate' },
      source: 'network',
    })
    return routed?.catch(() => {}) ?? Promise.resolve()
  } catch {
    // Without routes, page loads keep dispatching to the fetch handler, which declines them.
    return Promise.resolve()
  }
}

/** Install the emitted fetch allowlist, cache delivery and popup-owned port continuity. */
export function startRootWorker(scope: ServiceWorkerGlobalScope): void {
  installPortKeeper()
  const cache = new AssetCache(scope.location.origin)
  const journal = new Journal(scope.location.origin)
  /**
   * Keep one lifecycle occurrence for the next document to forward. `written` settles once it,
   * and every mark before it on the journal's queue, is stored.
   */
  const mark = (
    event: string,
    phase?: 'started' | 'finished',
    operationId = crypto.randomUUID(),
  ) => ({
    id: operationId,
    written: journal.record({ event, ...(phase && { phase }), timestamp: now(), operationId }),
  })
  // Each evaluation is one start of this Worker by the browser.
  mark('root-worker-start')
  const absolute = (r: (typeof allowedRequests)[number]) => ({
    ...r,
    url: new URL(r.url, scope.location.origin).href,
  })
  const allowed = new Map(allowedRequests.map(absolute).map((spec) => [requestKey(spec), spec]))
  const profiles = new Map(
    Object.entries(requestsByProfile).map(([profile, requests]) => [
      profile,
      requests.map(absolute),
    ]),
  )
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
    const requests = profiles.get(profile)
    // A build without this asset list (an older worker, or a retired version) says so at once.
    if (!requests) {
      reply.postMessage({ dispatched: false })
      reply.close()
      return true
    }
    const { dispatched, complete } = cache.prefetchAll(requests)
    const ack = dispatched.then((sources) => {
      const cached = sources.filter((source) => source === 'cache').length
      reply.postMessage({ dispatched: true, cached, fetched: sources.length - cached })
      reply.close()
    })
    event.waitUntil(Promise.all([ack, complete]).then(() => {}))
    return true
  }

  /** Report the profile's still-running and missing retrievals, once the running ones settle. */
  function onDownloads(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    const profile = profileOf(event, value)
    const requests = profile === undefined ? undefined : profiles.get(profile)
    if (!requests) return false
    const [reply] = event.ports
    event.waitUntil(
      cache.remaining(requests).then((report) => {
        reply.postMessage(report)
        reply.close()
      }),
    )
    return true
  }

  /** Hand over the kept lifecycle marks, removing them; the asker forwards them. */
  function onJournal(event: ExtendableMessageEvent, value: Record<string, unknown>): boolean {
    if (!hasExactKeys(value, ['type']) || event.ports.length !== 1) return false
    const [reply] = event.ports
    event.waitUntil(
      journal.drain().then((marks) => {
        reply.postMessage({ marks })
        reply.close()
      }),
    )
    return true
  }

  const handlers: Record<string, typeof onClaim> = {
    'ceremony-claim': onClaim,
    'ceremony-prefetch': onPrefetch,
    'ceremony-downloads': onDownloads,
    'ceremony-journal': onJournal,
  }

  scope.addEventListener('install', (event) => {
    // Prefetch waits for installation, so it never waits on Cache Storage: activation holds
    // these marks, which its own write follows on the journal's queue.
    const { id } = mark('root-worker-install', 'started')
    event.waitUntil(
      Promise.all([scope.skipWaiting(), routeNavigations(event)]).then(() => {
        mark('root-worker-install', 'finished', id)
      }),
    )
  })
  scope.addEventListener('activate', (event) => {
    const { id } = mark('root-worker-activate', 'started')
    // Kept alive until every mark so far is written; activation already waits on Cache Storage.
    event.waitUntil(
      Promise.all([cache.reconcile(allowed.values()), scope.clients.claim()]).then(
        () => mark('root-worker-activate', 'finished', id).written,
      ),
    )
  })
  scope.addEventListener('fetch', (event) => {
    // Without static routes, a page load reaches this Worker before the network.
    // The page load goes on to the network; the hold only keeps this Worker until it is marked.
    if (event.request.mode === 'navigate') event.waitUntil(mark('root-worker-navigation').written)
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
