import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeRegistration } from './keeper.js'
import { type CurrentWindow, PopupWindow } from './window.js'

const ORIGIN = 'https://popup.example'
const DOCUMENT = `${ORIGIN}/prover/x`
const NEXT = `${ORIGIN}/next`

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

/** A container with one script registered at any number of scopes. */
function container() {
  const registrations = new Map<string, { scope: string; active: unknown; installing: unknown }>()
  return {
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
    async getRegistrations() {
      return [...registrations.values()]
    },
  }
}

function current(sw: ReturnType<typeof container>, scope?: string): CurrentWindow {
  const view = { top: null as unknown, location: new URL(DOCUMENT) }
  view.top = view
  vi.stubGlobal('window', view)
  vi.stubGlobal('navigator', { serviceWorker: sw })
  return PopupWindow.current('', { scope }) as CurrentWindow
}

describe('registration selection [POPUP-KEEPER-005]', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('by default claims from every registration and keeps into the destination controller', async () => {
    const sw = container()
    const root = sw.add('/', worker('activated'))
    const nested = sw.add('/prover/', worker('activated'))
    const popup = current(sw)
    expect(await popup.registrations()).toEqual([root, nested])
    expect(await popup.registrations(NEXT)).toEqual([root])
    expect(await popup.registrations(DOCUMENT)).toEqual([nested])
  })

  it('with a scope uses exactly that registration for both, even under a nested controller', async () => {
    const sw = container()
    const root = sw.add('/', worker('activated'))
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    expect(await popup.registrations()).toEqual([root])
    expect(await popup.registrations(DOCUMENT)).toEqual([root])
  })

  it('with a scope substitutes nothing for a missing registration', async () => {
    vi.useFakeTimers()
    const sw = container()
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    expect(await popup.registrations()).toEqual([])
    const ready = activeRegistration(async () => (await popup.registrations(NEXT))[0])
    await vi.advanceTimersByTimeAsync(2_500)
    expect(await ready).toBeUndefined()
  })

  it('waits for a root registered and activated after the hop begins', async () => {
    vi.useFakeTimers()
    const sw = container()
    sw.add('/prover/', worker('activated'))
    const popup = current(sw, '/')
    const ready = activeRegistration(async () => (await popup.registrations(NEXT))[0])
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
  })

  it('rejects a cross-origin scope', () => {
    expect(() => current(container(), 'https://other.example/')).toThrow(TypeError)
  })
})

describe('default popup placement [POPUP-WINDOW-005]', () => {
  let open: typeof PopupWindow.open
  let nativeOpen: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    open = (await import('./window.js')).PopupWindow.open
    nativeOpen = vi.fn(() => ({ closed: false }))
    vi.stubGlobal('window', {
      open: nativeOpen,
      outerWidth: 1280,
      screenX: 80,
      screenY: 40,
      screen: { availWidth: 1600, availLeft: -1600, availTop: 24 },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('places mixed widths side by side, then staggers without consulting prior handles', () => {
    const first = {
      get closed(): boolean {
        throw new Error('Severed handle')
      },
    }
    nativeOpen.mockReturnValueOnce(first)
    open('one', 'width=480,height=720')
    open('two', 'innerWidth=600,height=720')
    open('three', 'width=480,height=720')
    open('four', 'width=480,height=720')
    expect(nativeOpen.mock.calls.map((call) => call[2])).toEqual([
      'popup,width=480,height=720,left=-1600,top=24',
      'popup,innerWidth=600,height=720,left=-1088,top=24',
      'popup,width=480,height=720,left=-1568,top=56',
      'popup,width=480,height=720,left=-1056,top=56',
    ])
  })

  it('uses the final width declaration after normalizing its alias', () => {
    open('wide', 'width=100,innerWidth=900')
    open('next', 'width=480')
    expect(nativeOpen).toHaveBeenLastCalledWith(
      'about:blank',
      'next',
      'popup,width=480,left=-668,top=24',
    )
  })

  it('keeps explicit positions, including aliases, and blocked opens out of the sequence', () => {
    for (const features of ['left=10', ' TOP = 10', 'ScreenX=-20', 'screenY=40']) {
      open('explicit', features)
      expect(nativeOpen).toHaveBeenLastCalledWith('about:blank', 'explicit', `popup,${features}`)
    }
    nativeOpen.mockReturnValueOnce(null)
    expect(open('blocked', 'width=480').opened).toBe(false)
    expect(open('first', 'width=480').opened).toBe(true)
    expect(nativeOpen.mock.calls.slice(-2).map((call) => call[2])).toEqual([
      'popup,width=480,left=-1600,top=24',
      'popup,width=480,left=-1600,top=24',
    ])
  })

  it('uses opener width when omitted and bounds repeated large-window launches', () => {
    open('default')
    expect(nativeOpen).toHaveBeenLastCalledWith('about:blank', 'default', 'popup,left=-1600,top=24')
    for (let i = 0; i < 20; i++) {
      open(`large-${i}`, 'width=9000')
      const features = nativeOpen.mock.lastCall![2] as string
      expect(features).toMatch(/,left=-1600,top=\d+$/)
      expect(Number(/top=(\d+)/.exec(features)![1])).toBeLessThan(280)
    }
  })
})
