import { installPortKeeper } from '@libid/popup/worker'
import { requestsByProfile, allowedRequests } from 'virtual:ceremony-assets'
import { AssetCache } from './cache.js'
import { hasExactKeys, isRecord } from '../primitives.js'
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
    const { response } = cache.load(spec)
    event.respondWith(response)
    event.waitUntil(
      response.then(
        () => {},
        () => {},
      ),
    )
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
    const dispatch = Promise.all(jobs.map((j) => j.dispatched)).then(() => {
      reply.postMessage({ dispatched: true })
      reply.close()
    })
    event.waitUntil(
      Promise.all([dispatch, ...jobs.map((j) => j.response.catch(() => {}))]).then(() => {}),
    )
  })
}
