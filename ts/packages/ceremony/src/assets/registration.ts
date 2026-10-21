const SERVICE_WORKER_TIMEOUT_MS = 15000
const ACTIVATION_POLL_INTERVAL_MS = 50

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

/** Register the build-pinned root script and return that Worker, never an older active one. */
export async function registerRootWorker(url: string): Promise<ServiceWorker> {
  const script = new URL(url, location.origin).href
  const registration = await navigator.serviceWorker.register(script, {
    scope: '/',
    type: 'module',
    updateViaCache: 'all',
  })
  if (registration.scope !== `${location.origin}/`)
    throw new Error('Incorrect Service Worker scope')
  // WebKit can resolve register() before the registration shows the Worker it installs.
  let pinned: ServiceWorker | null | undefined
  await within('Missing build-pinned Service Worker', (done, signal) => {
    const find = () => {
      pinned = [registration.installing, registration.waiting, registration.active].find(
        (worker) => worker?.scriptURL === script,
      )
      if (pinned) done()
    }
    const poll = setInterval(find, ACTIVATION_POLL_INTERVAL_MS)
    signal.addEventListener('abort', () => clearInterval(poll))
    registration.addEventListener('updatefound', find, { signal })
    find()
  })
  const worker = pinned!
  await within('Service Worker installation timed out', (done, signal) => {
    const changed = () => {
      if (worker.state === 'redundant') done(new Error('Service Worker failed'))
      else if (worker.state !== 'installing' && worker.state !== 'parsed') done()
    }
    // Concurrent Chromium popups can lose statechange notifications; sample the same state too.
    const poll = setInterval(changed, ACTIVATION_POLL_INTERVAL_MS)
    signal.addEventListener('abort', () => clearInterval(poll))
    worker.addEventListener('statechange', changed, { signal })
    changed()
  })
  return worker
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

/**
 * Dispatch directly to the selected Worker, including while it waits behind an older active one.
 * Resolves with how many requests were stored and fetched, when the Worker reports both.
 */
export async function dispatchPrefetch(
  worker: ServiceWorker,
  profile: string,
): Promise<{ cached: number; fetched: number } | undefined> {
  let counts: { cached: number; fetched: number } | undefined
  await within('Asset dispatch timed out', (done, signal) => {
    const channel = new MessageChannel()
    signal.addEventListener('abort', () => channel.port1.close())
    channel.port1.onmessage = (event) => {
      const { dispatched, cached, fetched } = event.data ?? {}
      if (isCount(cached) && isCount(fetched)) counts = { cached, fetched }
      if (dispatched === true) done()
      else if (dispatched === false) done(new Error('Asset profile not served'))
      else done(new Error('Invalid dispatch acknowledgement'))
    }
    try {
      worker.postMessage({ type: 'ceremony-prefetch', profile }, [channel.port2])
    } catch {
      channel.port2.close()
      done(new Error('Asset dispatch failed'))
    }
  })
  return counts
}

/**
 * The profile's retrievals still running, once they settle, and those neither running nor
 * stored. No deadline: downloads take what they take. A Worker that never answers leaves this
 * pending.
 */
export function remainingDownloads(profile: string): Promise<{ pending: number; missing: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ pending: number; missing: number }>()
  const worker = navigator.serviceWorker.controller
  if (!worker) {
    reject(new Error('Missing controlling Service Worker'))
    return promise
  }
  const channel = new MessageChannel()
  channel.port1.onmessage = ({ data }) => {
    channel.port1.close()
    if (isCount(data?.pending) && isCount(data?.missing))
      resolve({ pending: data.pending, missing: data.missing })
    else reject(new Error('Invalid download report'))
  }
  worker.postMessage({ type: 'ceremony-downloads', profile }, [channel.port2])
  return promise
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
