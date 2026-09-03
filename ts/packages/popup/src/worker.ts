// @libid/popup/worker — the Service Worker half of the continuity bridge.
// The host serves and registers the worker and owns its update policy; this
// handler only gives a port a temporary owner across one popup document
// replacement. It touches nothing but its own keep and claim records, never
// reads the port, keeps no durable record, and holds nothing past the claim
// deadline.

import { CARRIER_CLAIM_TIMEOUT_MS, decodeKeeperRequest, KEEP } from './keeper.js'

interface Held {
  port: MessagePort
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
        existing.port.close()
        port.close()
        reply.postMessage({ ok: false })
        return
      }
      let release!: () => void
      const done = new Promise<void>((resolve) => {
        release = resolve
      })
      const timer = setTimeout(() => {
        if (held.get(connectionId)?.port === port) {
          held.delete(connectionId)
          port.close()
        }
        release()
      }, CARRIER_CLAIM_TIMEOUT_MS)
      held.set(connectionId, {
        port,
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
    reply.postMessage({ port: true }, [existing.port])
  })
}

/** Composes the port keeper into the host's popup-origin Service Worker. */
export function installPortKeeper(): void {
  installPortKeeperOn(self as unknown as ServiceWorkerGlobalScope)
}
