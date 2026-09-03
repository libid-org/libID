import { describe, expect, it, vi } from 'vitest'
import { CONNECTION_VERSION } from './message.js'
import { listenForPopupPorts, PortCarrier, requestApplicationPort } from './port.js'
import {
  APP_ORIGIN,
  fakePair,
  type FakePair,
  ID,
  OTHER_ID,
  POPUP_ORIGIN,
  tick,
} from './testing/fakes.js'

const handshake = (connectionId = ID) => ({
  type: 'message-port',
  connectionVersion: CONNECTION_VERSION,
  connectionId,
})

interface Harness {
  pair: FakePair
  ports: MessagePort[]
  fails: number
  bound: unknown[]
  stop: () => void
}

function listen(source: 'handle' | null = 'handle', pair = fakePair()): Harness {
  const h: Harness = { pair, ports: [], fails: 0, bound: [], stop: () => {} }
  h.stop = listenForPopupPorts(
    {
      view: pair.appView,
      source: source === 'handle' ? (pair.popupProxy as unknown as WindowProxy) : null,
      onBind: (s) => void h.bound.push(s),
      allowedPopupOrigins: [POPUP_ORIGIN],
      connectionId: ID,
    },
    { onPort: (port) => void h.ports.push(port), onFail: () => void h.fails++ },
  )
  return h
}

const request = (
  pair: FakePair,
  overrides: Partial<Parameters<typeof requestApplicationPort>[0]> = {},
) =>
  requestApplicationPort({
    view: pair.popupView,
    opener: pair.appProxy as unknown as WindowProxy,
    allowedOrigins: [APP_ORIGIN],
    connectionId: ID,
    signal: new AbortController().signal,
    timeoutMs: 200,
    ...overrides,
  })

const requestPort = async (pair: FakePair, overrides = {}): Promise<MessagePort> => {
  const port = await request(pair, overrides)
  if (!port) throw new Error('expected a port')
  return port
}

async function roundTrip(app: MessagePort, popup: MessagePort): Promise<unknown[]> {
  const received: unknown[] = []
  popup.onmessage = (e) => void received.push(e.data)
  app.postMessage({ type: 'ping', n: 1 })
  await tick()
  return received
}

describe('MessagePort handshake [POPUP-PORT-001]', () => {
  it('authenticates both endpoints and resolves entangled ports after the echo', async () => {
    const h = listen()
    const popupPort = await requestPort(h.pair)
    await tick()
    expect(h.ports).toHaveLength(1)
    expect(h.fails).toBe(0)
    expect(await roundTrip(h.ports[0], popupPort)).toEqual([{ type: 'ping', n: 1 }])
    h.stop()
  })

  it('selects nothing before the popup echo', async () => {
    const h = listen()
    // Raw handshake from the popup without the echo step.
    h.pair.appProxy.postMessage(handshake(), '*')
    await tick()
    expect(h.ports).toHaveLength(0)
    expect(h.fails).toBe(0)
    h.stop()
  })

  it('rejects a mismatched echo and ignores a duplicate one', async () => {
    const h = listen()
    // Intercept the application's response to capture the transferred port.
    let transferred: MessagePort | undefined
    const observer = (event: MessageEvent) => {
      transferred = event.ports[0]
    }
    h.pair.popupView.addEventListener('message', observer)
    h.pair.appProxy.postMessage(handshake(), '*')
    await tick()
    h.pair.popupView.removeEventListener('message', observer)
    expect(transferred).toBeDefined()
    ;(transferred as MessagePort).postMessage({ ...handshake(), connectionVersion: 2 })
    await tick()
    expect(h.ports).toHaveLength(0)
    expect(h.fails).toBe(1)

    // A second echo after acceptance is an ordinary value, not a re-selection.
    const h2 = listen()
    const popupPort = await requestPort(h2.pair)
    await tick()
    popupPort.postMessage(handshake())
    await tick()
    expect(h2.ports).toHaveLength(1)
    expect(h2.fails).toBe(0)
    h.stop()
    h2.stop()
  })

  it('ignores events that are not addressed to this connection', async () => {
    const h = listen()
    h.pair.appProxy.postMessage({ type: 'oauth-result', state: 'x' }, '*')
    h.pair.appProxy.postMessage(handshake(OTHER_ID), '*')
    h.pair.appProxy.postMessage('string', '*')
    await tick()
    expect(h.fails).toBe(0)
    h.stop()
  })

  it('ignores an attempt from a wrong origin or source; rejects a malformed one from the peer', async () => {
    for (const ignored of [
      { data: handshake(), origin: 'https://evil.example', source: 'handle' },
      { data: handshake(), origin: POPUP_ORIGIN, source: 'other' },
    ]) {
      const h = listen()
      h.pair.appView.dispatch({
        ...ignored,
        source: ignored.source === 'handle' ? h.pair.popupProxy : {},
      })
      await tick()
      expect(h.fails, JSON.stringify(ignored)).toBe(0)
      expect(h.ports).toHaveLength(0)
      // Still live: a proper handshake succeeds afterwards.
      await requestPort(h.pair)
      await tick()
      expect(h.ports).toHaveLength(1)
      h.stop()
    }
    for (const bad of [
      { data: { ...handshake(), connectionVersion: 2 } },
      { data: { ...handshake(), extra: 1 } },
      { data: handshake(), ports: [new MessageChannel().port1] },
    ]) {
      const h = listen()
      h.pair.appView.dispatch({ origin: POPUP_ORIGIN, ...bad, source: h.pair.popupProxy })
      await tick()
      expect(h.fails, JSON.stringify(bad)).toBe(1)
      expect(h.ports).toHaveLength(0)
      h.stop()
    }
  })

  it('accepts sequential handshakes over one listener, superseding a pending attempt', async () => {
    const h = listen()
    const first = await requestPort(h.pair)
    await tick()
    // A second document handshakes; the first port is not disturbed by us.
    const second = await requestPort(h.pair)
    await tick()
    expect(h.ports).toHaveLength(2)
    expect(await roundTrip(h.ports[1], second)).toHaveLength(1)
    first.close()
    // A pending attempt (no echo yet) is superseded by a newer accepted one.
    h.pair.appProxy.postMessage(handshake(), '*')
    await tick()
    const third = await requestPort(h.pair)
    await tick()
    expect(h.ports).toHaveLength(3)
    expect(await roundTrip(h.ports[2], third)).toHaveLength(1)
    h.stop()
  })

  it('binds the native-anchor source once and pins it [POPUP-WINDOW-002]', async () => {
    const h = listen(null)
    const port = await requestPort(h.pair)
    await tick()
    expect(h.bound).toEqual([h.pair.popupProxy])
    expect(h.ports).toHaveLength(1)
    port.close()
    // A handshake from another window is not an attempt on this connection.
    h.pair.appView.dispatch({ data: handshake(), origin: POPUP_ORIGIN, source: {} })
    await tick()
    expect(h.fails).toBe(0)
    expect(h.bound).toHaveLength(1)
    h.stop()
  })

  it('stops listening and closes pending state on stop', async () => {
    const h = listen()
    h.stop()
    h.pair.appProxy.postMessage(handshake(), '*')
    await tick()
    expect(h.ports).toHaveLength(0)
    expect(h.pair.appView.listeners.size).toBe(0)
  })
})

describe('popup request', () => {
  it('rejects a response from the opener with a wrong origin, shape, or port count', async () => {
    const pair = fakePair()
    const cases: Array<{ data: unknown; origin: string; source: unknown; ports?: MessagePort[] }> =
      [
        {
          data: handshake(),
          origin: 'https://evil.example',
          source: pair.appProxy,
          ports: [new MessageChannel().port1],
        },
        { data: handshake(), origin: APP_ORIGIN, source: pair.appProxy, ports: [] },
        {
          data: { ...handshake(), connectionVersion: 2 },
          origin: APP_ORIGIN,
          source: pair.appProxy,
          ports: [new MessageChannel().port1],
        },
      ]
    for (const event of cases) {
      const pending = request(pair)
      pair.popupView.dispatch(event)
      await expect(pending).rejects.toThrow('handshake-rejected')
    }
    expect(pair.popupView.listeners.size).toBe(0)
  })

  it('ignores unrelated traffic and another window, then resolves null when the opener stays silent', async () => {
    const pair = fakePair()
    const pending = request(pair, { timeoutMs: 30 })
    pair.popupView.dispatch({ data: { type: 'noise' }, origin: APP_ORIGIN, source: pair.appProxy })
    pair.popupView.dispatch({
      data: handshake(OTHER_ID),
      origin: APP_ORIGIN,
      source: pair.appProxy,
    })
    pair.popupView.dispatch({
      data: handshake(),
      origin: APP_ORIGIN,
      source: {},
      ports: [new MessageChannel().port1],
    })
    await expect(pending).resolves.toBeNull()
    expect(pair.popupView.listeners.size).toBe(0)
  })

  it('rejects on abort', async () => {
    const pair = fakePair()
    const controller = new AbortController()
    const pending = request(pair, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('connection-closed')
  })
})

describe('PortCarrier [POPUP-PORT-002]', () => {
  it('forwards ordered structured-clone values without reallocation', async () => {
    const channel = new MessageChannel()
    const carrier = new PortCarrier(channel.port1)
    const received: unknown[] = []
    carrier.on((value) => void received.push(value))
    const bytes = new Uint8Array([1, 2, 3])
    channel.port2.postMessage({ type: 'a', bytes })
    channel.port2.postMessage({ type: 'b' })
    await tick()
    expect(received.map((v) => (v as { type: string }).type)).toEqual(['a', 'b'])
    expect((received[0] as { bytes: Uint8Array }).bytes).toBeInstanceOf(Uint8Array)
    carrier.close()
    expect(() => carrier.send({ type: 'x' })).toThrow('send-unavailable')
    expect(() => carrier.close()).not.toThrow()
  })

  it('detaches the same entangled port and closes itself', async () => {
    const channel = new MessageChannel()
    const carrier = new PortCarrier(channel.port1)
    const handler = vi.fn()
    carrier.on(handler)
    const port = carrier.detach()
    expect(port).toBe(channel.port1)
    expect(() => carrier.send({ type: 'x' })).toThrow('send-unavailable')
    const received: unknown[] = []
    port.onmessage = (e) => void received.push(e.data)
    channel.port2.postMessage({ type: 'after' })
    await tick()
    expect(handler).not.toHaveBeenCalled()
    expect(received).toEqual([{ type: 'after' }])
  })
})
