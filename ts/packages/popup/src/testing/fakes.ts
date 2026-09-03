// In-memory stand-ins for the browser surfaces the package touches: two
// windows that postMessage each other with browser-stamped origin and
// source, and a Service Worker scope wired to a keeper client. Real Node
// MessageChannel ports flow through unchanged, so port semantics are real.

import type { KeeperWorker } from '../keeper.js'
import type { View } from '../window.js'
import { installPortKeeperOn } from '../worker.js'

export const APP_ORIGIN = 'https://app.example'
export const POPUP_ORIGIN = 'https://popup.example'
export const ID = '1c037b6a-2f08-4b17-9f9e-0d9a6a5b3c2d'
export const OTHER_ID = '2d148c7b-3f19-4c28-8a0f-1e0b7b6c4d3e'

export const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Listener = (event: MessageEvent) => void

export interface FakeView extends View {
  readonly listeners: Set<Listener>
  dispatch(event: { data: unknown; origin: string; source: unknown; ports?: MessagePort[] }): void
}

export function fakeView(): FakeView {
  const listeners = new Set<Listener>()
  return {
    listeners,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    dispatch(event) {
      const message = { ports: [], ...event } as unknown as MessageEvent
      // Tasks, not microtasks: listeners run after the current stack.
      setTimeout(() => {
        for (const listener of [...listeners]) listener(message)
      }, 0)
    },
  }
}

/** A WindowProxy as seen from the other side of the opener relationship. */
export interface FakeProxy {
  closed: boolean
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void
  location: { origin: string; replace(url: string): void }
  close(): void
  replaced: string[]
}

/** Two documents that see each other as opener and popup. */
export interface FakePair {
  appView: FakeView
  popupView: FakeView
  /** The handle the application retains (or binds); posts into the popup. */
  popupProxy: FakeProxy
  /** The popup's `opener`; posts into the application. */
  appProxy: FakeProxy
  /** The popup document as a Window for CurrentWindow. */
  popupWindow: Window
  /** Replace the popup document with one on another origin; proxies keep identity. */
  relocate(origin: string): void
}

export function fakePair(popupOrigin = POPUP_ORIGIN): FakePair {
  const appView = fakeView()
  const popupView = fakeView()
  const state = { popupOrigin }
  const makeProxy = (
    target: FakeView,
    targetOrigin: () => string,
    stampedOrigin: () => string,
    self: () => FakeProxy,
  ): FakeProxy => {
    const proxy: FakeProxy = {
      closed: false,
      replaced: [],
      postMessage(message, origin, transfer = []) {
        if (proxy.closed) return
        if (origin !== '*' && origin !== targetOrigin()) return
        target.dispatch({
          data: structuredClone(message),
          origin: stampedOrigin(),
          source: self(),
          ports: transfer as MessagePort[],
        })
      },
      location: {
        get origin() {
          return targetOrigin()
        },
        replace: (url) => void proxy.replaced.push(url),
      },
      close: () => {
        proxy.closed = true
      },
    }
    return proxy
  }
  // Each proxy stamps the *sender's* identity as `source`.
  let appProxy!: FakeProxy
  let popupProxy!: FakeProxy
  const popupOriginNow = () => state.popupOrigin
  popupProxy = makeProxy(
    popupView,
    popupOriginNow,
    () => APP_ORIGIN,
    () => appProxy,
  )
  appProxy = makeProxy(
    appView,
    () => APP_ORIGIN,
    popupOriginNow,
    () => popupProxy,
  )

  const popupWindow = {
    addEventListener: popupView.addEventListener,
    removeEventListener: popupView.removeEventListener,
    get opener() {
      return appProxy
    },
    location: popupProxy.location,
    close: popupProxy.close,
  } as unknown as Window
  return {
    appView,
    popupView,
    popupProxy,
    appProxy,
    popupWindow,
    relocate(origin) {
      state.popupOrigin = origin
      popupView.listeners.clear()
    },
  }
}

export interface FakeScope {
  /** Post as a same-origin document client. */
  worker: KeeperWorker
  /** Post as a client from another origin. */
  foreignWorker: KeeperWorker
  pending: Promise<unknown>[]
}

/** The real worker handler on a fake ServiceWorkerGlobalScope. */
export function fakeScope(origin = POPUP_ORIGIN): FakeScope {
  const handlers = new Map<string, (event: unknown) => void>()
  const pending: Promise<unknown>[] = []
  installPortKeeperOn({
    location: { origin },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler)
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  } as unknown as ServiceWorkerGlobalScope)
  const post = (url: string): KeeperWorker => ({
    postMessage(message, transfer) {
      setTimeout(() => {
        handlers.get('message')?.({
          data: structuredClone(message),
          ports: transfer,
          source: { url },
          waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
        })
      }, 0)
    },
  })
  return {
    worker: post(`${origin}/p`),
    foreignWorker: post('https://evil.example/p'),
    pending,
  }
}

export const registrationWith = (worker: KeeperWorker | null) => () =>
  Promise.resolve({ active: worker } as unknown as ServiceWorkerRegistration)
