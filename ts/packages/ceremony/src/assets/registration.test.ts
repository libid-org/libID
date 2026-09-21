import { afterEach, expect, it, vi } from 'vitest'
import { dispatchPrefetch, rootWorker } from './registration.js'

afterEach(() => vi.unstubAllGlobals())

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
