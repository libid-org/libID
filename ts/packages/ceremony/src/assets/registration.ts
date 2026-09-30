import { route } from './keys.js'

const SERVICE_WORKER_TIMEOUT_MS = 15000
const ACTIVATION_POLL_INTERVAL_MS = 50
/** How long an update check or a new worker's activation may hold up a working active worker. */
const ACTIVE_WORKER_GRACE_MS = 3000

/**
 * Settle through `done` within `ms` (15 seconds by default). Settling, including a synchronous
 * throw from `start`, clears the timer and aborts `signal`, removing listeners registered with it.
 */
function within(
  timeout: string,
  start: (done: (error?: unknown) => void, signal: AbortSignal) => void,
  ms = SERVICE_WORKER_TIMEOUT_MS,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const settled = new AbortController()
  const timer = setTimeout(() => done(new Error(timeout)), ms)
  const done = (error?: unknown) => {
    clearTimeout(timer)
    settled.abort()
    if (error === undefined) resolve()
    else reject(error)
  }
  try {
    start(done, settled.signal)
  } catch (error) {
    done(error)
  }
  return promise
}

/** Register the canonical root worker and retire only the known legacy nested scope. */
export async function registerRootWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(route('worker.js'), {
    scope: '/',
    type: 'module',
    updateViaCache: 'none',
  })
  if (registration.scope !== `${location.origin}/`)
    throw new Error('Incorrect Service Worker scope')
  // Registering an unchanged URL skips the update check, so after a deployment the new
  // worker may not exist yet. A failed or slow check keeps the active worker.
  if (registration.active && !registration.installing && !registration.waiting)
    await within(
      'Service Worker update timed out',
      (done) => void registration.update().then(() => done(), done),
      ACTIVE_WORKER_GRACE_MS,
    ).catch(() => {})
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) throw new Error('Missing Service Worker')
  // An active worker can handle messages while activating. WebKit can retain that
  // state in another document; the dispatch acknowledgement is our readiness gate.
  if (worker !== registration.active) {
    // A new worker cannot activate while the previous one still serves another Prefetch; that
    // one can serve this dispatch too, and answers an asset list it lacks at once.
    const previous = registration.active
    await within(
      'Service Worker activation timed out',
      (done, signal) => {
        const changed = () => {
          if (worker.state === 'activating' || worker.state === 'activated') done()
          else if (worker.state === 'redundant') done(new Error('Service Worker failed'))
        }
        // Concurrent Chromium popups can miss statechange while worker.state still updates.
        const poll = setInterval(changed, ACTIVATION_POLL_INTERVAL_MS)
        signal.addEventListener('abort', () => clearInterval(poll))
        worker.addEventListener('statechange', changed, { signal })
        changed()
      },
      previous ? ACTIVE_WORKER_GRACE_MS : SERVICE_WORKER_TIMEOUT_MS,
    ).catch((error: unknown) => {
      if (!previous) throw error
    })
  }
  // Retire only the known legacy scope. A root worker cannot claim pages that
  // still match a longer registration; popup port selection alone cannot fix it.
  const script = new URL(route('worker.js'), location.origin).href
  for (const old of await navigator.serviceWorker.getRegistrations()) {
    const workers = [old.active, old.waiting, old.installing].filter((worker) => worker !== null)
    if (
      old.scope === `${location.origin}/ccdp/v1/` &&
      workers.length &&
      workers.every((worker) => worker.scriptURL === script)
    )
      await old.unregister()
  }
  return registration
}

/** Wait for fetch-dispatch acknowledgement for this profile, not download completion. */
export async function dispatchPrefetch(
  registration: ServiceWorkerRegistration,
  profile: string,
): Promise<void> {
  await within('Asset dispatch timed out', (done, signal) => {
    const channel = new MessageChannel()
    signal.addEventListener('abort', () => channel.port1.close())
    channel.port1.onmessage = (event) => {
      const { dispatched } = event.data ?? {}
      if (dispatched === true) done()
      else if (dispatched === false) done(new Error('Asset profile not served'))
      else done(new Error('Invalid dispatch acknowledgement'))
    }
    try {
      registration.active!.postMessage({ type: 'ceremony-prefetch', profile }, [channel.port2])
    } catch {
      channel.port2.close()
      done(new Error('Asset dispatch failed'))
    }
  })
}

/** Newly isolated documents can initially be uncontrolled; claim before execution fetches. */
export async function claimRootWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (registration?.scope !== `${location.origin}/` || !registration.active)
    throw new Error('Missing root Service Worker')
  if (navigator.serviceWorker.controller === registration.active) return
  await within('Service Worker control timed out', (done, signal) => {
    const channel = new MessageChannel()
    signal.addEventListener('abort', () => channel.port1.close())
    const changed = () => {
      if (navigator.serviceWorker.controller === registration.active) done()
    }
    navigator.serviceWorker.addEventListener('controllerchange', changed, { signal })
    channel.port1.onmessage = changed
    registration.active!.postMessage({ type: 'ceremony-claim' }, [channel.port2])
    changed()
  })
}
