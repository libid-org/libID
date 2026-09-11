import { allowedRequests, requestsByProfile } from 'virtual:ceremony-assets'
import { installPortKeeper } from '@libid/popup/worker'
import { hasExactKeys, isRecord } from '../primitives.js'
import { AssetCache } from './cache.js'

/** Install the emitted fetch allowlist, cache delivery and popup-owned port continuity. */
export function startWorker(scope: ServiceWorkerGlobalScope): void {
  installPortKeeper()
  const cache = new AssetCache(scope.location.origin)
  const resolve = (r: (typeof allowedRequests)[number]) => ({
    ...r,
    url: new URL(r.url, scope.location.origin).href,
  })
  const allowed = new Map(
    allowedRequests.map((r) => {
      const spec = resolve(r)
      return [`${spec.url}\n${spec.range ?? ''}`, spec]
    }),
  )
  scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
  scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
  scope.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return
    const spec = allowed.get(`${event.request.url}\n${event.request.headers.get('range') ?? ''}`)
    if (!spec) return
    const { response, complete } = cache.load(spec)
    event.respondWith(response)
    event.waitUntil(complete)
  })
  scope.addEventListener('message', (event) => {
    const value: unknown = event.data
    if (!isRecord(value)) return
    if (
      value.type === 'ceremony-claim' &&
      hasExactKeys(value, ['type']) &&
      event.ports.length === 1 &&
      event.source &&
      'url' in event.source &&
      new URL(event.source.url).origin === scope.location.origin
    ) {
      const port = event.ports[0]
      event.waitUntil(
        scope.clients.claim().then(() => {
          port.postMessage({ claimed: true })
          port.close()
        }),
      )
      return
    }
    if (value.type !== 'ceremony-prefetch') return
    const reply = event.ports[0]
    if (
      !reply ||
      event.ports.length !== 1 ||
      !hasExactKeys(value, ['type', 'profile']) ||
      typeof value.profile !== 'string' ||
      !Object.hasOwn(requestsByProfile, value.profile) ||
      !event.source ||
      !('url' in event.source) ||
      new URL(event.source.url).origin !== scope.location.origin
    ) {
      for (const port of event.ports) port.close()
      return
    }
    const jobs = requestsByProfile[value.profile].map((r) => cache.load(resolve(r)))
    for (const job of jobs) void job.response.catch(() => {})
    const dispatch = Promise.all(jobs.map((j) => j.dispatched)).then(() => {
      reply.postMessage({ dispatched: true })
      reply.close()
    })
    event.waitUntil(Promise.all([dispatch, ...jobs.map((j) => j.complete)]).then(() => {}))
  })
}
