import { describe, expect, it, vi } from 'vitest'
import { PopupConnection } from './connection.js'
import type { PopupDiagnostic } from './diagnostics.js'
import type { Carrier, Message } from './message.js'
import { PortCarrier } from './port.js'
import {
  APP_ORIGIN,
  fakePair,
  type FakePair,
  fakeScope,
  ID,
  OTHER_ID,
  POPUP_ORIGIN,
  registrationWith,
  tick,
} from './testing/fakes.js'
import { CurrentWindow, OpenedWindow, PopupWindow } from './window.js'

class Ready implements Message {
  static readonly type = 'ready'
  readonly type = Ready.type
  constructor(readonly version: number) {}
  static decode(value: unknown): Ready {
    const v = value as { version?: unknown }
    if (typeof v.version !== 'number') throw new Error('bad ready')
    return new Ready(v.version)
  }
}
class Start implements Message {
  static readonly type = 'start'
  readonly type = Start.type
  static decode(value: unknown): Start {
    if ((value as { type: string }).type !== 'start') throw new Error('bad start')
    return new Start()
  }
}
type Messages = Ready | Start

const codes = (events: PopupDiagnostic[]) => events.map((e) => e.code)

interface Side {
  events: PopupDiagnostic[]
}

/** An application endpoint over a fake pair with a scripted or blocked handle. */
function connectApp(pair: FakePair, opts: { blocked?: boolean; fallback?: Carrier } = {}) {
  const side: Side = { events: [] }
  const popup = new OpenedWindow(
    opts.blocked ? null : (pair.popupProxy as unknown as WindowProxy),
    pair.appView,
  )
  const connection = PopupConnection.connect<Messages>(popup, {
    connectionId: ID,
    popupOrigin: POPUP_ORIGIN,
    onDiagnostic: (e) => void side.events.push(e),
    ...(opts.fallback && { fallback: () => Promise.resolve(opts.fallback as Carrier) }),
  })
  return { connection, popup, ...side }
}

/** A popup endpoint over the same pair. */
function acceptPopup(
  pair: FakePair,
  opts: {
    worker?: Parameters<typeof registrationWith>[0]
    fallback?: Carrier
    opener?: boolean
  } = {},
) {
  const side: Side = { events: [] }
  const view = opts.opener === false ? { ...pair.popupWindow, opener: null } : pair.popupWindow
  const popup = new CurrentWindow(
    view as Window,
    opts.worker === undefined ? Promise.resolve(undefined) : registrationWith(opts.worker),
  )
  const connection = PopupConnection.accept<Messages>(popup, {
    connectionId: ID,
    allowedApplicationOrigins: [APP_ORIGIN],
    onDiagnostic: (e) => void side.events.push(e),
    ...(opts.fallback && { fallback: () => Promise.resolve(opts.fallback as Carrier) }),
  })
  return { connection, ...side }
}

/** Both ends of a test carrier over one MessageChannel. */
function carrierPair(): [PortCarrier, PortCarrier] {
  const channel = new MessageChannel()
  return [new PortCarrier(channel.port1), new PortCarrier(channel.port2)]
}

describe('validation [POPUP-CONNECTION-007]', () => {
  it('rejects bad ids and origins before any browser work', async () => {
    const pair = fakePair()
    const popup = new OpenedWindow(pair.popupProxy as unknown as WindowProxy, pair.appView)
    expect(() =>
      PopupConnection.connect(popup, { connectionId: ID.toUpperCase(), popupOrigin: POPUP_ORIGIN }),
    ).toThrow(TypeError)
    expect(() =>
      PopupConnection.connect(popup, { connectionId: ID, popupOrigin: `${POPUP_ORIGIN}/` }),
    ).toThrow(TypeError)
    expect(pair.appView.listeners.size).toBe(0)
    const current = new CurrentWindow(pair.popupWindow, Promise.resolve(undefined))
    await expect(
      PopupConnection.accept(current, {
        connectionId: 'nope',
        allowedApplicationOrigins: [APP_ORIGIN],
      }),
    ).rejects.toThrow(TypeError)
    await expect(
      PopupConnection.accept(current, { connectionId: ID, allowedApplicationOrigins: [] }),
    ).rejects.toThrow(TypeError)
    expect(pair.popupView.listeners.size).toBe(0)
  })

  it('requires the matching PopupWindow kind and one connect per object', () => {
    const pair = fakePair()
    const popup = new OpenedWindow(pair.popupProxy as unknown as WindowProxy, pair.appView)
    const current = new CurrentWindow(pair.popupWindow, Promise.resolve(undefined))
    expect(() =>
      PopupConnection.connect(current, { connectionId: ID, popupOrigin: POPUP_ORIGIN }),
    ).toThrow(TypeError)
    PopupConnection.connect(popup, { connectionId: ID, popupOrigin: POPUP_ORIGIN })
    expect(() =>
      PopupConnection.connect(popup, { connectionId: ID, popupOrigin: POPUP_ORIGIN }),
    ).toThrow('already connected')
  })

  it('PopupWindow.open rejects reserved and empty targets [POPUP-WINDOW-001/003]', () => {
    for (const target of ['', '_blank', '_self', '_parent', '_top', '_custom']) {
      expect(() => PopupWindow.open(target)).toThrow(TypeError)
    }
  })
})

describe('MessagePort selection and delivery', () => {
  it('connects, exchanges typed messages, and keeps decode identity [POPUP-API-001/002]', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    const readies: Ready[] = []
    app.connection.on(Ready, (r) => void readies.push(r))
    const popup = await acceptPopup(pair).connection
    const starts: Start[] = []
    popup.on(Start, (s) => void starts.push(s))
    await tick()
    expect(codes(app.events)).toEqual(['window-opened', 'carrier-message-port'])

    popup.send(new Ready(1))
    app.connection.send(new Start())
    await tick()
    expect(readies).toHaveLength(1)
    expect(readies[0]).toBeInstanceOf(Ready)
    expect(readies[0].version).toBe(1)
    expect(starts).toHaveLength(1)
  })

  it('rejects reserved and duplicate registrations and sends [POPUP-API-001/002]', () => {
    const pair = fakePair()
    const { connection } = connectApp(pair)
    const off = connection.on(Ready, () => {})
    expect(() => connection.on(Ready, () => {})).toThrow('already registered')
    off()
    expect(() => connection.on(Ready, () => {})).not.toThrow()
    expect(() =>
      connection.on({ type: 'navigate', decode: () => new Ready(1) } as never, () => {}),
    ).toThrow('reserved')
    expect(() => connection.send({ type: 'close-popup' } as never)).toThrow('reserved')
  })

  it('throws on send without a carrier and queues nothing [POPUP-CONNECTION-004]', () => {
    const pair = fakePair()
    const app = connectApp(pair)
    expect(() => app.connection.send(new Start())).toThrow('send-unavailable')
    expect(codes(app.events)).toContain('send-unavailable')
  })

  it('closes on unknown, malformed, or decoder-rejected input [POPUP-API-003]', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const bad of [
      { type: 'unknown' },
      { type: 'ready', version: 'x' },
      'text',
      { type: '' },
    ]) {
      const pair = fakePair()
      const app = connectApp(pair)
      const handler = vi.fn()
      app.connection.on(Ready, handler)
      const popup = await acceptPopup(pair).connection
      await tick()
      // Bypass the typed API: push a raw value over the popup's carrier.
      ;(popup as unknown as { carrier: Carrier }).carrier.send(bad as Message)
      await tick()
      expect(handler).not.toHaveBeenCalled()
      expect(codes(app.events).at(-1)).toBe('decode-rejected')
      expect(codes(app.events)).toContain('connection-failed')
      expect(() => app.connection.send(new Start())).toThrow('send-unavailable')
    }
    error.mockRestore()
  })

  it('keeps concurrent connections isolated by id [POPUP-API-004]', async () => {
    const a = fakePair()
    const b = fakePair()
    // Both applications share one page (view) but bind different popups.
    const appA = connectApp(a)
    const appB = new OpenedWindow(b.popupProxy as unknown as WindowProxy, a.appView)
    const eventsB: PopupDiagnostic[] = []
    const connB = PopupConnection.connect<Messages>(appB, {
      connectionId: OTHER_ID,
      popupOrigin: POPUP_ORIGIN,
      onDiagnostic: (e) => void eventsB.push(e),
    })
    const readyA = vi.fn()
    const readyB = vi.fn()
    appA.connection.on(Ready, readyA)
    connB.on(Ready, readyB)
    // Popup A's handshake reaches both listeners on the shared page.
    const popupA = await acceptPopup(a).connection
    await tick()
    expect(codes(appA.events)).toContain('carrier-message-port')
    expect(codes(eventsB)).not.toContain('handshake-rejected')
    expect(codes(eventsB)).not.toContain('connection-failed')
    popupA.send(new Ready(7))
    await tick()
    expect(readyA).toHaveBeenCalledTimes(1)
    expect(readyB).not.toHaveBeenCalled()
  })
})

describe('native-anchor path [POPUP-WINDOW-002] [POPUP-CONTROL-001]', () => {
  it('performs no browser operation while binding is pending, then binds', async () => {
    const pair = fakePair()
    const app = connectApp(pair, { blocked: true })
    expect(app.popup.opened).toBe(false)
    await expect(app.connection.navigate('https://popup.example/p')).resolves.toBeUndefined()
    expect(pair.popupProxy.replaced).toEqual([])
    await acceptPopup(pair).connection
    await tick()
    expect(app.popup.opened).toBe(true)
    expect(codes(app.events)).toEqual(['window-blocked', 'window-bound', 'carrier-message-port'])
  })
})

describe('controls [POPUP-CONTROL-001/002/003/004]', () => {
  it('navigates directly without a carrier and over the carrier with one', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    await app.connection.navigate('https://popup.example/p')
    expect(pair.popupProxy.replaced).toEqual(['https://popup.example/p'])
    expect(codes(app.events).at(-1)).toBe('control-direct')

    const scope = fakeScope()
    await acceptPopup(pair, { worker: scope.worker }).connection
    await tick()
    await app.connection.navigate('https://popup.example/isolated')
    expect(codes(app.events).at(-1)).toBe('control-connected')
    await tick(20)
    // The popup kept its port with the worker and replaced itself.
    expect(scope.pending).toHaveLength(1)
    expect(pair.popupProxy.replaced).toEqual([
      'https://popup.example/p',
      'https://popup.example/isolated',
    ])
  })

  it('rejects malformed navigation before any browser operation', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    for (const bad of [
      'http://popup.example/p',
      'https://u:p@popup.example/p',
      '/p',
      'https://popup.example',
    ]) {
      await expect(app.connection.navigate(bad)).rejects.toThrow(TypeError)
    }
    expect(pair.popupProxy.replaced).toEqual([])
    expect(codes(app.events).filter((c) => c === 'control-rejected')).toHaveLength(4)
  })

  it('continues the same connection in the next document after a connected navigation', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    const readies: number[] = []
    app.connection.on(Ready, (r) => void readies.push(r.version))
    const scope = fakeScope()
    await acceptPopup(pair, { worker: scope.worker }).connection
    await tick()
    await app.connection.navigate('https://popup.example/isolated')
    await tick(20)
    // The destination document claims and continues with the same port.
    const next = await acceptPopup(pair, { worker: scope.worker, opener: false })
    const nextEvents = next.events
    const connection = await next.connection
    expect(codes(nextEvents)).toEqual(['carrier-restored'])
    connection.send(new Ready(2))
    await tick()
    expect(readies).toEqual([2])
  })

  it('fails closed without continuity instead of navigating', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pair = fakePair()
    connectApp(pair)
    const popupSide = acceptPopup(pair)
    const popup = await popupSide.connection
    await tick()
    await expect(popup.navigate('https://popup.example/isolated')).rejects.toThrow(
      'continuity-unsupported',
    )
    expect(pair.popupProxy.replaced).toEqual([])
    expect(codes(popupSide.events)).toContain('connection-failed')
    error.mockRestore()
  })

  it('closes directly with a live handle, over the carrier after severing, and is idempotent', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    const popupSide = acceptPopup(pair)
    await popupSide.connection
    await tick()
    await app.connection.close()
    expect(pair.popupProxy.closed).toBe(true)
    await expect(app.connection.close()).resolves.toBeUndefined()
    expect(codes(app.events).filter((c) => c === 'connection-closed')).toHaveLength(1)

    // Severed: the handle reports closed but the port is alive.
    const pair2 = fakePair()
    const app2 = connectApp(pair2)
    const popup2Side = acceptPopup(pair2)
    await popup2Side.connection
    await tick()
    const closeSpy = vi.spyOn(pair2.popupWindow, 'close')
    pair2.popupProxy.closed = true
    await app2.connection.close()
    await tick()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(codes(popup2Side.events)).toContain('connection-closed')
    expect(() => app2.connection.send(new Start())).toThrow('send-unavailable')
  })

  it('rejects wrong-direction, duplicate, and post-terminal controls', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Wrong direction: a control arriving at the application fails it.
    const pair = fakePair()
    const app = connectApp(pair)
    const popup = await acceptPopup(pair).connection
    await tick()
    ;(popup as unknown as { carrier: Carrier }).carrier.send({ type: 'close-popup' })
    await tick()
    expect(codes(app.events).at(-1)).toBe('control-rejected')

    // Duplicate: the second control performs no browser operation.
    const pair2 = fakePair()
    const app2 = connectApp(pair2)
    const scope = fakeScope()
    await acceptPopup(pair2, { worker: scope.worker }).connection
    await tick()
    const raw = (app2.connection as unknown as { carrier: Carrier }).carrier
    raw.send({ type: 'navigate', url: 'https://popup.example/a' } as Message)
    raw.send({ type: 'navigate', url: 'https://popup.example/b' } as Message)
    raw.send({ type: 'close-popup' })
    await tick(20)
    expect(pair2.popupProxy.replaced).toEqual(['https://popup.example/a'])
    expect(pair2.popupProxy.closed).toBe(false)
    error.mockRestore()
  })
})

describe('fallback seam [POPUP-CONNECTION-002/004/005] [POPUP-DIAGNOSTIC-003]', () => {
  it('fails closed with fallback-unavailable exactly once when no opener and no constructor', async () => {
    const pair = fakePair()
    const side = acceptPopup(pair, { opener: false })
    await expect(side.connection).rejects.toThrow('fallback-unavailable')
    expect(codes(side.events)).toEqual(['fallback-unavailable'])
  })

  it('emits no fallback diagnostic when MessagePort succeeds', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    const side = acceptPopup(pair)
    await side.connection
    await tick()
    expect(codes(app.events).concat(codes(side.events))).not.toContain('fallback-unavailable')
  })

  it('invokes the application constructor once, installs the carrier only when it resolves, and aborts on close', async () => {
    const pair = fakePair()
    const [appCarrier, popupCarrier] = carrierPair()
    const signals: AbortSignal[] = []
    let resolveFallback: (c: Carrier) => void = () => {}
    const fallback = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<Carrier>((resolve) => {
        resolveFallback = resolve
      })
    })
    const popup = new OpenedWindow(pair.popupProxy as unknown as WindowProxy, pair.appView)
    const events: PopupDiagnostic[] = []
    const connection = PopupConnection.connect<Messages>(popup, {
      connectionId: ID,
      popupOrigin: POPUP_ORIGIN,
      fallback,
      onDiagnostic: (e) => void events.push(e),
    })
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(signals[0].aborted).toBe(false)
    expect(() => connection.send(new Start())).toThrow('send-unavailable')

    // MessagePort wins first; the standby stays armed.
    await acceptPopup(pair).connection
    await tick()
    expect(codes(events)).toContain('carrier-message-port')

    // The popup's next document commits fallback: resolution replaces the port carrier.
    const readies: number[] = []
    connection.on(Ready, (r) => void readies.push(r.version))
    resolveFallback(appCarrier)
    await tick()
    expect(codes(events).at(-1)).toBe('carrier-fallback')
    popupCarrier.send(new Ready(3))
    await tick()
    expect(readies).toEqual([3])

    await connection.close()
    expect(signals[0].aborted).toBe(true)
  })

  it('the popup commits its constructor only after MessagePort is unavailable', async () => {
    const pair = fakePair()
    const [appCarrier, popupCarrier] = carrierPair()
    const fallback = vi.fn(() => Promise.resolve(popupCarrier))
    const popup = new CurrentWindow(
      { ...pair.popupWindow, opener: null } as Window,
      Promise.resolve(undefined),
    )
    const events: PopupDiagnostic[] = []
    const connection = await PopupConnection.accept<Messages>(popup, {
      connectionId: ID,
      allowedApplicationOrigins: [APP_ORIGIN],
      fallback,
      onDiagnostic: (e) => void events.push(e),
    })
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(codes(events)).toEqual(['carrier-fallback'])
    const starts = vi.fn()
    connection.on(Start, starts)
    appCarrier.send(new Start())
    await tick()
    expect(starts).toHaveBeenCalledTimes(1)
    // Navigation over a non-port carrier fails closed [POPUP-CONNECTION-008].
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(connection.navigate('https://popup.example/next')).rejects.toThrow(
      'continuity-unsupported',
    )
    error.mockRestore()
  })

  it('the popup with an opener never invokes its constructor', async () => {
    const pair = fakePair()
    connectApp(pair)
    const [, popupCarrier] = carrierPair()
    const fallback = vi.fn(() => Promise.resolve(popupCarrier))
    const side = acceptPopup(pair, { fallback: popupCarrier })
    await side.connection
    expect(fallback).not.toHaveBeenCalled()
    expect(codes(side.events)).toEqual(['carrier-message-port'])
  })
})

describe('loss is never an outcome [POPUP-CONNECTION-006]', () => {
  it('a closed popup port delivers nothing and resolves no caller operation', async () => {
    const pair = fakePair()
    const app = connectApp(pair)
    const handler = vi.fn()
    app.connection.on(Ready, handler)
    const popup = await acceptPopup(pair).connection
    await tick()
    ;(popup as unknown as { carrier: Carrier }).carrier.close()
    await tick()
    expect(handler).not.toHaveBeenCalled()
    expect(codes(app.events)).not.toContain('connection-closed')
    expect(codes(app.events)).not.toContain('connection-failed')
  })
})
