import { afterEach, expect, it, type Mock, vi } from 'vitest'
import { claimRootWorker, dispatchPrefetch, registerRootWorker } from './registration.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const ORIGIN = 'https://ccdp.example'

const SCRIPT = `${ORIGIN}/ccdp/v1/worker.js`

type FakeServiceWorker = EventTarget & {
  state: ServiceWorkerState
  scriptURL: string
  postMessage: Mock<(message: unknown, transfer: MessagePort[]) => void>
}

/** A Service Worker double; when given, `reply` answers every message on its transferred port. */
function serviceWorker(state: ServiceWorkerState, reply?: unknown, scriptURL = SCRIPT) {
  const worker: FakeServiceWorker = Object.assign(new EventTarget(), {
    state,
    scriptURL,
    postMessage: vi.fn((_message: unknown, [port]: MessagePort[]) => {
      if (reply === undefined) return
      port.postMessage(reply)
      port.close()
    }),
  })
  return worker
}

/** A registration double; unset worker slots are null, as the browser reports them. */
function registration(
  scope: string,
  workers: Partial<Record<'active' | 'waiting' | 'installing', FakeServiceWorker | object>> = {},
) {
  const double = {
    scope,
    active: null,
    waiting: null,
    installing: null,
    unregister: vi.fn(async () => true),
    update: vi.fn(async () => double),
    ...workers,
  }
  return double as unknown as ServiceWorkerRegistration & { unregister: Mock; update: Mock }
}

/** Stub the container: `register` and `getRegistration` resolve `current`. */
function install(
  current: Partial<ServiceWorkerRegistration> | undefined,
  registrations = [current],
) {
  vi.stubGlobal('location', { origin: ORIGIN })
  const container = Object.assign(new EventTarget(), {
    controller: null as unknown,
    register: vi.fn().mockResolvedValue(current),
    getRegistration: vi.fn().mockResolvedValue(current),
    getRegistrations: vi.fn().mockResolvedValue(registrations),
  })
  vi.stubGlobal('navigator', { serviceWorker: container })
  return container
}

it('uses dispatch acknowledgement when another document retains an activating worker', async () => {
  const active = serviceWorker('activating', { dispatched: true })
  const root = registration(`${ORIGIN}/`, { active })
  install(root)
  // No statechange will arrive, as in the concurrent WebKit popup failure.
  await dispatchPrefetch(await registerRootWorker(), 'google/1')
  expect(active.postMessage).toHaveBeenCalledWith(
    { type: 'ceremony-prefetch', profile: 'google/1' },
    expect.any(Array),
  )
})

it('waits for an installing update to become active instead of using the old worker [LIBID-ASSET-014]', async () => {
  const worker = serviceWorker('installing')
  const root = registration(`${ORIGIN}/`, { active: {}, installing: worker })
  install(root)
  const ready = registerRootWorker()
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled())
  expect(settled).toBe(false)
  Object.assign(root, { active: worker, installing: null })
  worker.state = 'activating'
  worker.dispatchEvent(new Event('statechange'))
  await expect(ready).resolves.toBe(root)
})

it('checks for a deployed update before dispatching to the active worker [LIBID-ASSET-014]', async () => {
  const previous = serviceWorker('activated', { dispatched: true })
  const deployed = serviceWorker('installing', { dispatched: true })
  const root = registration(`${ORIGIN}/`, { active: previous })
  root.update.mockImplementation(async () => {
    Object.assign(root, { installing: deployed })
    // The browser then activates it in place of the previous worker.
    queueMicrotask(() => {
      Object.assign(root, { active: deployed, installing: null })
      deployed.state = 'activating'
      deployed.dispatchEvent(new Event('statechange'))
    })
    return root
  })
  install(root)
  await dispatchPrefetch(await registerRootWorker(), 'google/2')
  expect(deployed.postMessage).toHaveBeenCalledOnce()
  expect(previous.postMessage).not.toHaveBeenCalled()
  // A failed check keeps the active worker.
  root.update.mockRejectedValue(new Error('offline'))
  await expect(registerRootWorker()).resolves.toBe(root)
})

it('keeps a working active worker when the update check or the new worker stalls [LIBID-ASSET-014]', async () => {
  vi.useFakeTimers()
  const previous = serviceWorker('activated', { dispatched: true })
  const root = registration(`${ORIGIN}/`, { active: previous })
  // A stalled check of worker.js.
  root.update.mockReturnValue(new Promise(() => {}))
  install(root)
  const stalledCheck = registerRootWorker()
  await vi.advanceTimersByTimeAsync(3000)
  await expect(stalledCheck).resolves.toBe(root)
  // A new worker that cannot activate while the previous one is still busy.
  Object.assign(root, { waiting: serviceWorker('installed') })
  const waiting = registerRootWorker()
  await vi.advanceTimersByTimeAsync(3000)
  await expect(waiting).resolves.toBe(root)
  vi.useRealTimers()
  await dispatchPrefetch(root, 'google/1')
  expect(previous.postMessage).toHaveBeenCalledOnce()
})

it('fails at once when the worker does not serve the asset list [LIBID-ASSET-014]', async () => {
  const root = registration(`${ORIGIN}/`, {
    active: serviceWorker('activated', { dispatched: false }),
  })
  await expect(dispatchPrefetch(root, 'google/9')).rejects.toThrow('Asset profile not served')
})

it('observes activation when a concurrent popup loses worker statechange notifications', async () => {
  vi.useFakeTimers()
  const worker = serviceWorker('installing')
  const root = registration(`${ORIGIN}/`, { installing: worker })
  install(root)
  const activated = vi.fn()
  const ready = registerRootWorker().then(activated)
  await vi.advanceTimersByTimeAsync(0)
  // Chromium updates these objects without always delivering statechange.
  Object.assign(root, { active: worker, installing: null })
  worker.state = 'activated'
  await vi.advanceTimersByTimeAsync(50)
  expect(activated).toHaveBeenCalledWith(root)
  await ready
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds activation and releases timers when installation stalls', async () => {
  vi.useFakeTimers()
  install(registration(`${ORIGIN}/`, { installing: serviceWorker('installing') }))
  const failed = expect(registerRootWorker()).rejects.toThrow('Service Worker activation timed out')
  await vi.advanceTimersByTimeAsync(15000)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})

it('registers the root module worker and retires only the legacy scope running it [LIBID-ASSET-020]', async () => {
  const root = registration(`${ORIGIN}/`, { active: serviceWorker('activated') })
  const legacy = registration(`${ORIGIN}/ccdp/v1/`, {
    active: serviceWorker('activated'),
    waiting: serviceWorker('installed'),
  })
  const kept = [
    registration(`${ORIGIN}/ccdp/v1/`, {
      active: serviceWorker('activated', undefined, `${ORIGIN}/ccdp/v1/other.js`),
    }),
    registration(`${ORIGIN}/ccdp/v1/`, {
      active: serviceWorker('activated'),
      installing: serviceWorker('installing', undefined, `${ORIGIN}/ccdp/v2/worker.js`),
    }),
    registration(`${ORIGIN}/ccdp/`, { active: serviceWorker('activated') }),
    registration(`${ORIGIN}/ccdp/v1/`),
  ]
  const container = install(root, [root, legacy, ...kept])
  await expect(registerRootWorker()).resolves.toBe(root)
  expect(container.register).toHaveBeenCalledExactlyOnceWith('/ccdp/v1/worker.js', {
    scope: '/',
    type: 'module',
    updateViaCache: 'none',
  })
  expect(legacy.unregister).toHaveBeenCalledOnce()
  for (const other of [root, ...kept]) expect(other.unregister).not.toHaveBeenCalled()
})

it.each([
  [
    'a registration outside the root scope',
    registration(`${ORIGIN}/ccdp/v1/`, { active: serviceWorker('activated') }),
    'Incorrect Service Worker scope',
  ],
  ['a registration without a worker', registration(`${ORIGIN}/`), 'Missing Service Worker'],
  [
    'an update that becomes redundant',
    registration(`${ORIGIN}/`, { installing: serviceWorker('redundant') }),
    'Service Worker failed',
  ],
])('rejects %s', async (_, current, reason) => {
  install(current)
  await expect(registerRootWorker()).rejects.toThrow(reason)
})

it('rejects an invalid dispatch acknowledgement', async () => {
  const root = registration(`${ORIGIN}/`, {
    active: serviceWorker('activated', { dispatched: 'yes' }),
  })
  await expect(dispatchPrefetch(root, 'google/1')).rejects.toThrow(
    'Invalid dispatch acknowledgement',
  )
})

it('reports a dispatch that cannot be posted', async () => {
  const active = serviceWorker('activated')
  active.postMessage.mockImplementation(() => {
    throw new DOMException('Worker is gone', 'InvalidStateError')
  })
  await expect(dispatchPrefetch(registration(`${ORIGIN}/`, { active }), 'x/1')).rejects.toThrow(
    'Asset dispatch failed',
  )
})

it('bounds dispatch acknowledgement and releases timers when the worker never replies', async () => {
  vi.useFakeTimers()
  const root = registration(`${ORIGIN}/`, { active: serviceWorker('activated') })
  const failed = expect(dispatchPrefetch(root, 'google/1')).rejects.toThrow(
    'Asset dispatch timed out',
  )
  await vi.advanceTimersByTimeAsync(15000)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps a page the root worker already controls without claiming it', async () => {
  const active = serviceWorker('activated', { claimed: true })
  const container = install(registration(`${ORIGIN}/`, { active }))
  container.controller = active
  await claimRootWorker()
  expect(container.getRegistration).toHaveBeenCalledExactlyOnceWith('/')
  expect(active.postMessage).not.toHaveBeenCalled()
})

it.each(['controllerchange', 'claim reply'])(
  'claims an uncontrolled page through the root worker, settling on its %s [LIBID-ASSET-020]',
  async (signal) => {
    const active = serviceWorker('activated')
    const container = install(registration(`${ORIGIN}/`, { active }))
    const claimed = vi.fn()
    const claiming = claimRootWorker().then(claimed)
    await vi.waitFor(() =>
      expect(active.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ceremony-claim' }, [
        expect.any(MessagePort),
      ]),
    )
    expect(claimed).not.toHaveBeenCalled()
    // Either signal alone settles the claim once the root worker controls the page.
    container.controller = active
    if (signal === 'controllerchange') container.dispatchEvent(new Event('controllerchange'))
    else active.postMessage.mock.calls[0][1][0].postMessage({ claimed: true })
    await claiming
    expect(claimed).toHaveBeenCalledOnce()
  },
)

it.each([
  ['no registration', undefined],
  [
    'a nested registration',
    registration(`${ORIGIN}/ccdp/v1/`, { active: serviceWorker('activated') }),
  ],
  [
    'an inactive root registration',
    registration(`${ORIGIN}/`, { installing: serviceWorker('installing') }),
  ],
])('refuses to claim through %s', async (_, current) => {
  install(current)
  await expect(claimRootWorker()).rejects.toThrow('Missing root Service Worker')
})

it('bounds control and releases timers when the claim never takes effect', async () => {
  vi.useFakeTimers()
  const active = serviceWorker('activated', { claimed: true })
  install(registration(`${ORIGIN}/`, { active }))
  const failed = expect(claimRootWorker()).rejects.toThrow('Service Worker control timed out')
  await vi.advanceTimersByTimeAsync(15000)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects a claim that cannot be posted and releases its timer', async () => {
  vi.useFakeTimers()
  const active = serviceWorker('activated')
  const reason = new DOMException('Worker is gone', 'InvalidStateError')
  active.postMessage.mockImplementation(() => {
    throw reason
  })
  install(registration(`${ORIGIN}/`, { active }))
  await expect(claimRootWorker()).rejects.toBe(reason)
  expect(vi.getTimerCount()).toBe(0)
})
