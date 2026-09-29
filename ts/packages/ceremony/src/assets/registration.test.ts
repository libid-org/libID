import { afterEach, expect, it, vi } from 'vitest'
import { dispatchPrefetch, rootWorker } from './registration.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function install(registration: Partial<ServiceWorkerRegistration>) {
  vi.stubGlobal('location', { origin: 'https://ccdp.example' })
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: vi.fn().mockResolvedValue(registration),
      getRegistrations: vi.fn().mockResolvedValue([registration]),
    },
  })
}

it('uses dispatch acknowledgement when another document retains an activating worker', async () => {
  const active = Object.assign(new EventTarget(), {
    state: 'activating',
    scriptURL: 'https://ccdp.example/ccdp/v1/worker.js',
    postMessage: vi.fn((_message, [port]) => {
      port.postMessage({ dispatched: true })
      port.close()
    }),
  }) as unknown as ServiceWorker
  const registration: Partial<ServiceWorkerRegistration> = {
    scope: 'https://ccdp.example/',
    active,
    installing: null,
    waiting: null,
  }
  install(registration)
  // No statechange will arrive, as in the concurrent WebKit popup failure.
  await dispatchPrefetch(await rootWorker(), 'google/1')
  expect(active.postMessage).toHaveBeenCalledWith(
    { type: 'ceremony-prefetch', profile: 'google/1' },
    expect.any(Array),
  )
})

it('waits for an installing update to become active instead of using the old worker', async () => {
  const worker = Object.assign(new EventTarget(), { state: 'installing' })
  const registration: Partial<ServiceWorkerRegistration> = {
    scope: 'https://ccdp.example/',
    active: {} as ServiceWorker,
    installing: worker as unknown as ServiceWorker,
    waiting: null,
  }
  install(registration)
  const ready = rootWorker()
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled())
  expect(settled).toBe(false)
  Object.assign(registration, { active: worker, installing: null })
  worker.state = 'activating'
  worker.dispatchEvent(new Event('statechange'))
  await expect(ready).resolves.toBe(registration)
})

it('observes activation when a concurrent popup loses worker statechange notifications', async () => {
  vi.useFakeTimers()
  const worker = Object.assign(new EventTarget(), { state: 'installing' })
  const registration: Partial<ServiceWorkerRegistration> = {
    scope: 'https://ccdp.example/',
    active: null,
    installing: worker as unknown as ServiceWorker,
    waiting: null,
  }
  install(registration)
  const activated = vi.fn()
  const ready = rootWorker().then(activated)
  await vi.advanceTimersByTimeAsync(0)
  // Chromium updates these objects without always delivering statechange.
  Object.assign(registration, { active: worker, installing: null })
  worker.state = 'activated'
  await vi.advanceTimersByTimeAsync(50)
  expect(activated).toHaveBeenCalledWith(registration)
  await ready
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds activation and releases timers when installation stalls', async () => {
  vi.useFakeTimers()
  install({
    scope: 'https://ccdp.example/',
    active: null,
    installing: Object.assign(new EventTarget(), { state: 'installing' }) as ServiceWorker,
    waiting: null,
  })
  const failed = expect(rootWorker()).rejects.toThrow('Service Worker activation timed out')
  await vi.advanceTimersByTimeAsync(15000)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})
