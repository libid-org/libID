import { afterEach, expect, it, type Mock, vi } from 'vitest'
import { claimRootWorker, dispatchPrefetch, registerRootWorker } from './registration.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const ORIGIN = 'https://ccdp.example'

const SCRIPT = `${ORIGIN}/ccdp/worker.${'a'.repeat(64)}.js`
const OLD_SCRIPT = `${ORIGIN}/ccdp/worker.${'b'.repeat(64)}.js`

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
  return worker as unknown as ServiceWorker & FakeServiceWorker
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

it.each(['activating', 'activated'] as const)(
  'reuses a matching %s worker without an update check [TEST-DIST-08]',
  async (state) => {
    const active = serviceWorker(state, { dispatched: true })
    const root = registration(`${ORIGIN}/`, { active })
    const container = install(root)
    await dispatchPrefetch(await registerRootWorker(SCRIPT), 'google/1')
    expect(active.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: 'ceremony-prefetch', profile: 'google/1' },
      expect.any(Array),
    )
    expect(container.register).toHaveBeenCalledExactlyOnceWith(SCRIPT, {
      scope: '/',
      type: 'module',
      updateViaCache: 'all',
    })
    expect(root.update).not.toHaveBeenCalled()
  },
)

it('dispatches to the matching replacement while an older worker remains active [LIBID-ASSET-014] [TEST-DIST-08]', async () => {
  const previous = serviceWorker('activated', { dispatched: true }, OLD_SCRIPT)
  const worker = serviceWorker('installing', { dispatched: true })
  const root = registration(`${ORIGIN}/`, { active: previous, installing: worker })
  install(root)
  const ready = registerRootWorker(SCRIPT)
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled())
  expect(settled).toBe(false)
  Object.assign(root, { installing: null, waiting: worker })
  worker.state = 'installed'
  worker.dispatchEvent(new Event('statechange'))
  // Waiting Workers can receive dispatch without having to control this page.
  await dispatchPrefetch(await ready, 'google/1')
  expect(worker.postMessage).toHaveBeenCalledOnce()
  expect(previous.postMessage).not.toHaveBeenCalled()
})

it('selects an already waiting matching Worker instead of the old active one [TEST-DIST-08]', async () => {
  const previous = serviceWorker('activated', { dispatched: true }, OLD_SCRIPT)
  const worker = serviceWorker('installed', { dispatched: true })
  install(registration(`${ORIGIN}/`, { active: previous, waiting: worker }))
  await dispatchPrefetch(await registerRootWorker(SCRIPT), 'google/1')
  expect(worker.postMessage).toHaveBeenCalledOnce()
  expect(previous.postMessage).not.toHaveBeenCalled()
})

it('never falls back to an old Worker when installation stalls [TEST-DIST-08]', async () => {
  vi.useFakeTimers()
  const previous = serviceWorker('activated', { dispatched: true }, OLD_SCRIPT)
  install(registration(`${ORIGIN}/`, { active: previous, installing: serviceWorker('installing') }))
  const failed = expect(registerRootWorker(SCRIPT)).rejects.toThrow(
    'Service Worker installation timed out',
  )
  await vi.advanceTimersByTimeAsync(15000)
  await failed
  expect(previous.postMessage).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('observes readiness when a concurrent popup loses worker statechange notifications', async () => {
  vi.useFakeTimers()
  const worker = serviceWorker('installing')
  install(registration(`${ORIGIN}/`, { installing: worker }))
  const ready = registerRootWorker(SCRIPT)
  await vi.advanceTimersByTimeAsync(0)
  worker.state = 'installed'
  await vi.advanceTimersByTimeAsync(50)
  await expect(ready).resolves.toBe(worker)
  expect(vi.getTimerCount()).toBe(0)
})

it('retires only the known nested worker scope [LIBID-ASSET-020]', async () => {
  const active = serviceWorker('activated')
  const root = registration(`${ORIGIN}/`, { active })
  const legacy = [
    registration(`${ORIGIN}/ccdp/v1/`, { active: serviceWorker('activated') }),
    registration(`${ORIGIN}/ccdp/v1/`, {
      active: serviceWorker('activated', undefined, `${ORIGIN}/ccdp/v1/worker.js`),
    }),
  ]
  const kept = [
    registration(`${ORIGIN}/ccdp/v1/`, {
      active: serviceWorker('activated', undefined, `${ORIGIN}/ccdp/v1/other.js`),
    }),
    registration(`${ORIGIN}/ccdp/v1/`, {
      active,
      installing: serviceWorker('installing', undefined, `${ORIGIN}/ccdp/v2/worker.js`),
    }),
    registration(`${ORIGIN}/ccdp/`, { active }),
    registration(`${ORIGIN}/ccdp/v1/`),
  ]
  install(root, [root, ...legacy, ...kept])
  await expect(registerRootWorker(SCRIPT)).resolves.toBe(active)
  for (const old of legacy) expect(old.unregister).toHaveBeenCalledOnce()
  for (const other of [root, ...kept]) expect(other.unregister).not.toHaveBeenCalled()
})

it.each([
  [
    registration(`${ORIGIN}/ccdp/v1/`, { active: serviceWorker('activated') }),
    'Incorrect Service Worker scope',
  ],
  [registration(`${ORIGIN}/`), 'Missing build-pinned Service Worker'],
  [
    registration(`${ORIGIN}/`, { active: serviceWorker('activated', undefined, OLD_SCRIPT) }),
    'Missing build-pinned Service Worker',
  ],
  [
    registration(`${ORIGIN}/`, {
      active: serviceWorker('activated', undefined, OLD_SCRIPT),
      installing: serviceWorker('redundant'),
    }),
    'Service Worker failed',
  ],
])('rejects an unusable registration: %s', async (current, reason) => {
  install(current)
  await expect(registerRootWorker(SCRIPT)).rejects.toThrow(reason)
})

it.each([
  [{ dispatched: false }, 'Asset profile not served'],
  [{ dispatched: 'yes' }, 'Invalid dispatch acknowledgement'],
])('rejects an unsuccessful dispatch: %s [LIBID-ASSET-014]', async (reply, error) => {
  await expect(dispatchPrefetch(serviceWorker('activated', reply), 'google/1')).rejects.toThrow(
    error,
  )
})

it('reports a dispatch that cannot be posted', async () => {
  const worker = serviceWorker('activated')
  worker.postMessage.mockImplementation(() => {
    throw new DOMException('Worker is gone', 'InvalidStateError')
  })
  await expect(dispatchPrefetch(worker, 'x/1')).rejects.toThrow('Asset dispatch failed')
})

it('bounds dispatch acknowledgement and releases timers when the worker never replies', async () => {
  vi.useFakeTimers()
  const failed = expect(dispatchPrefetch(serviceWorker('activated'), 'google/1')).rejects.toThrow(
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
