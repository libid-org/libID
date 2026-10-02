import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeRegistration } from './keeper.js'
import { fakePair, noRegistration } from './testing/fakes.js'
import { CurrentWindow, OpenedWindow, PopupWindow } from './window.js'

const ORIGIN = 'https://popup.example'
const DOCUMENT = `${ORIGIN}/prover/x`
const NEXT = `${ORIGIN}/next`
/** The names `open` and `fromAnchor` give popups. */
const NAME = /^popup-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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
    open('width=480,height=720')
    open('innerWidth=600,height=720')
    open('width=480,height=720')
    open('width=480,height=720')
    expect(nativeOpen.mock.calls.map((call) => call[2])).toEqual([
      'popup,width=480,height=720,left=-1600,top=24',
      'popup,innerWidth=600,height=720,left=-1088,top=24',
      'popup,width=480,height=720,left=-1568,top=56',
      'popup,width=480,height=720,left=-1056,top=56',
    ])
  })

  it('uses the final width declaration after normalizing its alias', () => {
    open('width=100,innerWidth=900')
    open('width=480')
    expect(nativeOpen).toHaveBeenLastCalledWith(
      'about:blank',
      expect.stringMatching(NAME),
      'popup,width=480,left=-668,top=24',
    )
  })

  it('keeps explicit positions, including aliases, and blocked opens out of the sequence', () => {
    for (const features of ['left=10', ' TOP = 10', 'ScreenX=-20', 'screenY=40']) {
      open(features)
      expect(nativeOpen).toHaveBeenLastCalledWith(
        'about:blank',
        expect.stringMatching(NAME),
        `popup,${features}`,
      )
    }
    nativeOpen.mockReturnValueOnce(null)
    expect(open('width=480').opened).toBe(false)
    expect(open('width=480').opened).toBe(true)
    expect(nativeOpen.mock.calls.slice(-2).map((call) => call[2])).toEqual([
      'popup,width=480,left=-1600,top=24',
      'popup,width=480,left=-1600,top=24',
    ])
  })

  it('uses opener width when omitted and bounds repeated large-window launches', () => {
    open()
    expect(nativeOpen).toHaveBeenLastCalledWith(
      'about:blank',
      expect.stringMatching(NAME),
      'popup,left=-1600,top=24',
    )
    for (let i = 0; i < 20; i++) {
      open('width=9000')
      const features = nativeOpen.mock.lastCall![2] as string
      expect(features).toMatch(/,left=-1600,top=\d+$/)
      expect(Number(/top=(\d+)/.exec(features)![1])).toBeLessThan(280)
    }
  })
})

describe('PopupWindow', () => {
  const stubWindow = (open: () => unknown) =>
    vi.stubGlobal('window', {
      open,
      outerWidth: 1280,
      screen: { availWidth: 1920, availLeft: 0, availTop: 0 },
    })

  it('PopupWindow.open names each popup freshly, always separate and keeping the opener [POPUP-WINDOW-001]', () => {
    const open = vi.fn((..._: string[]) => null)
    stubWindow(open)
    try {
      PopupWindow.open()
      PopupWindow.open('width=480,height=720')
      expect(open.mock.calls).toEqual([
        ['about:blank', expect.stringMatching(NAME), 'popup,left=0,top=0'],
        ['about:blank', expect.stringMatching(NAME), 'popup,width=480,height=720,left=0,top=0'],
      ])
      expect(open.mock.calls[0][1]).not.toBe(open.mock.calls[1][1])
      expect(() => PopupWindow.open('noopener')).toThrow(TypeError)
      expect(() => PopupWindow.open('width=1,NoReferrer')).toThrow(TypeError)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe('fromAnchor [POPUP-WINDOW-002]', () => {
    class Anchor {
      target = ''
      href = ''
      constructor(readonly rel = '') {}
    }
    const click = (currentTarget: unknown) => ({
      currentTarget,
      eventPhase: Event.AT_TARGET as number,
      preventDefault: vi.fn(),
    })
    beforeEach(() => vi.stubGlobal('HTMLAnchorElement', Anchor))
    afterEach(() => vi.unstubAllGlobals())

    it('opens the scripted window first and then suppresses the anchor', () => {
      const open = vi.fn((..._: string[]) => ({ closed: false }))
      stubWindow(open)
      const anchor = new Anchor()
      const event = click(anchor)
      const popup = PopupWindow.fromAnchor(
        event as unknown as MouseEvent,
        'width=480',
      ) as OpenedWindow
      expect(popup.opened).toBe(true)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(anchor.target).toBe(open.mock.calls[0][1])
      expect(popup.anchor).toBeNull()
    })

    it('leaves a blocked activation to the anchor, pointed only while it still dispatches', () => {
      stubWindow(() => null)
      const anchor = new Anchor()
      const event = click(anchor)
      const popup = PopupWindow.fromAnchor(event as unknown as MouseEvent) as OpenedWindow
      expect(popup.opened).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(anchor.target).toMatch(NAME)
      popup.pointAnchor(`${NEXT}#a=1`)
      expect(anchor.href).toBe(`${NEXT}#a=1`)
      // After dispatch the anchor has navigated already; a late destination changes nothing.
      event.eventPhase = Event.NONE
      popup.pointAnchor(DOCUMENT)
      expect(anchor.href).toBe(`${NEXT}#a=1`)
    })

    it('refuses, navigating nowhere, an activation that would not keep the opener', () => {
      const open = vi.fn(() => null)
      stubWindow(open)
      for (const [target, features] of [
        [{}, ''],
        [null, ''],
        [new Anchor('noopener'), ''],
        [new Anchor('external noreferrer'), ''],
        [new Anchor('NoOpEnEr'), ''],
        [new Anchor('external\tNoReFeRrEr'), ''],
        [new Anchor(), 'width=480,noopener'],
      ] as const) {
        const event = click(target)
        expect(() => PopupWindow.fromAnchor(event as unknown as MouseEvent, features)).toThrow(
          TypeError,
        )
        expect(event.preventDefault).toHaveBeenCalledOnce()
      }
      expect(open).not.toHaveBeenCalled()
    })
  })

  it('PopupWindow.current rejects an embedded document', () => {
    const frame = { top: {} }
    vi.stubGlobal('window', frame)
    expect(() => PopupWindow.current()).toThrow('top-level popup')
    vi.unstubAllGlobals()
  })

  it('treats inaccessible popup handles and openers as absent', () => {
    const inaccessible = Object.defineProperty({}, 'closed', {
      get: () => {
        throw new DOMException('discarded')
      },
    }) as WindowProxy
    expect(new OpenedWindow(inaccessible, fakePair().appView).direct).toBe(false)
    expect(new CurrentWindow({ opener: inaccessible } as Window, noRegistration).opener).toBeNull()
  })

  it('adopts the captured fragment from a bootstrap that cleared the URL [POPUP-CONNECTION-013]', () => {
    const view = { top: null as unknown, location: { hash: '#c=1' } }
    view.top = view
    vi.stubGlobal('window', view)
    vi.stubGlobal('navigator', {})
    try {
      const captured = PopupWindow.current('#c=1&t=2') as CurrentWindow
      view.location.hash = ''
      expect(captured.fragment).toBe('c=1&t=2')
      expect((PopupWindow.current() as CurrentWindow).fragment).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
