import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CurrentWindow, PopupWindow } from './window.js'

const ORIGIN = 'https://popup.example'
const DOCUMENT = `${ORIGIN}/prover/x`

/** A fake ServiceWorker that activates on demand. */
function worker(state: 'installing' | 'activated') {
  const listeners = new Set<() => void>()
  return {
    state,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    activate() {
      this.state = 'activated'
      for (const l of listeners) l()
    },
  }
}

/** A container with the same script registered at any number of scopes. */
function container() {
  const registrations = new Map<string, { scope: string; active: unknown; installing: unknown }>()
  return {
    registrations,
    add(scope: string, w: ReturnType<typeof worker> | null) {
      const registration = {
        scope: `${ORIGIN}${scope}`,
        worker: w, // null until the engine attaches the installing worker
        get active() {
          return this.worker?.state === 'activated' ? this.worker : null
        },
        get installing() {
          return this.worker?.state === 'installing' ? this.worker : null
        },
        waiting: null,
      }
      registrations.set(registration.scope, registration)
      return registration
    },
    // Like the platform: the longest registered scope that prefixes the URL.
    async getRegistration(url: string = DOCUMENT) {
      let best: { scope: string } | undefined
      for (const r of registrations.values()) {
        if (url.startsWith(r.scope) && (!best || r.scope.length > best.scope.length)) best = r
      }
      return best
    },
  }
}

function current(sw: ReturnType<typeof container>, scope?: string): CurrentWindow {
  const view = { top: null as unknown, location: new URL(DOCUMENT) }
  view.top = view
  vi.stubGlobal('window', view)
  vi.stubGlobal('navigator', { serviceWorker: sw })
  return PopupWindow.current('', scope === undefined ? {} : { scope }) as CurrentWindow
}

describe('registration selection [POPUP-KEEPER-005]', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('defaults to the registration controlling the document', async () => {
    const sw = container()
    sw.add('/', worker('activated'))
    sw.add('/prover/', worker('activated'))
    expect((await current(sw).registration())?.scope).toBe(`${ORIGIN}/prover/`)
  })

  it('uses exactly the named scope even when a nested registration controls the document', async () => {
    const sw = container()
    const root = sw.add('/', worker('activated'))
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    expect(await popup.registration()).toBe(root)
    expect(await popup.readyRegistration()).toBe(root)
  })

  it('never falls back to another scope', async () => {
    vi.useFakeTimers()
    const sw = container()
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    expect(await popup.registration()).toBeUndefined()
    const ready = popup.readyRegistration()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(await ready).toBeUndefined()
  })

  it('waits for a root registered and activated after construction', async () => {
    vi.useFakeTimers()
    const sw = container()
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    const ready = popup.readyRegistration()
    await vi.advanceTimersByTimeAsync(300)
    // Firefox exposes the registration before attaching its worker.
    const root = sw.add('/', null)
    await vi.advanceTimersByTimeAsync(300)
    const installing = worker('installing')
    root.worker = installing
    await vi.advanceTimersByTimeAsync(300)
    let settled = false
    void ready.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false) // found, still installing
    installing.activate()
    expect(await ready).toBe(root)
    expect(await popup.registration()).toBe(root)
  })

  it('rejects a cross-origin scope', () => {
    expect(() => current(container(), 'https://other.example/')).toThrow(TypeError)
  })
})
