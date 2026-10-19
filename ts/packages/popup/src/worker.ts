// @libid/popup/worker — the Service Worker half of the continuity bridge.
// The host serves and registers the worker and owns its update policy; this
// handler only gives a port a temporary owner across one popup document
// replacement. It touches nothing but its own keep and claim records, never
// reads the port or its backlog, keeps no durable record, and holds a port only
// until the claim deadline, counted from when the keeping document was last
// present. A duplicate keep tells both applications their document departed;
// an expired port closes silently, so a later document can still re-establish.

import { CARRIER_CLAIM_TIMEOUT_MS, decodeKeeperRequest, depart, KEEP } from './keeper.js'

/** How often the worker checks that the document keeping a port is still present. */
export const PRESENCE_CHECK_MS = 1_000

interface Held {
  port: MessagePort
  peerOrigin: string
  backlog: unknown[] | undefined
  release: () => void
}

function clientOrigin(source: ExtendableMessageEvent['source']): string | null {
  if (!source || !('url' in source)) return null
  try {
    return new URL(source.url).origin
  } catch {
    return null
  }
}

/** @internal Installs the handler on an explicit scope; tests inject a fake. */
export function installPortKeeperOn(scope: ServiceWorkerGlobalScope): void {
  const held = new Map<string, Held>()

  scope.addEventListener('message', (event) => {
    const request = decodeKeeperRequest(event.data)
    if (!request) return // not ours: the host's own traffic passes untouched
    const closeAll = (): void => {
      for (const port of event.ports) port.close()
    }
    if (clientOrigin(event.source) !== scope.location.origin) {
      closeAll()
      return
    }
    const { connectionId } = request
    const existing = held.get(connectionId)

    if (request.type === KEEP) {
      if (event.ports.length !== 2) {
        closeAll()
        return
      }
      const [port, reply] = event.ports
      if (existing) {
        // Duplicate ownership rejects both and closes every reachable port.
        held.delete(connectionId)
        existing.release()
        depart(existing.port)
        depart(port)
        reply.postMessage({ ok: false })
        return
      }
      let release!: () => void
      const done = new Promise<void>((resolve) => {
        release = resolve
      })
      // A keeping document still present has not left (WebKit can stall its
      // navigation while it retries), so the destination's deadline starts
      // only once it is gone.
      const keeping = (event.source as Client).id
      let deadline = Date.now() + CARRIER_CLAIM_TIMEOUT_MS
      let timer: ReturnType<typeof setTimeout>
      const check = async (): Promise<void> => {
        // ponytail: nothing announces a client leaving; poll.
        const present = await scope.clients.get(keeping).catch(() => undefined)
        if (present) deadline = Date.now() + CARRIER_CLAIM_TIMEOUT_MS
        if (held.get(connectionId)?.port !== port) return // claimed or rejected meanwhile
        if (Date.now() < deadline) {
          timer = setTimeout(check, PRESENCE_CHECK_MS)
          return
        }
        held.delete(connectionId)
        // No departure: the application keeps waiting for a later document.
        port.close()
        release()
      }
      timer = setTimeout(check, PRESENCE_CHECK_MS)
      held.set(connectionId, {
        port,
        peerOrigin: request.peerOrigin,
        backlog: request.backlog,
        release: () => {
          clearTimeout(timer)
          release()
        },
      })
      event.waitUntil(done)
      reply.postMessage({ ok: true })
      return
    }

    if (event.ports.length !== 1) {
      closeAll()
      return
    }
    const [reply] = event.ports
    if (!existing) {
      reply.postMessage({ port: false })
      return
    }
    held.delete(connectionId)
    existing.release()
    const { peerOrigin, backlog } = existing
    reply.postMessage({ port: true, peerOrigin, ...(backlog && { backlog }) }, [existing.port])
  })
}

/** Composes the port keeper into the host's popup-origin Service Worker. */
export function installPortKeeper(): void {
  installPortKeeperOn(self as unknown as ServiceWorkerGlobalScope)
}
